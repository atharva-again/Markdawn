package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"github.com/charmbracelet/huh"
)

type lifecycleItemResult struct {
	Reference              string      `json:"reference"`
	SourceID               string      `json:"sourceId,omitempty"`
	ID                     string      `json:"id,omitempty"`
	Status                 string      `json:"status"`
	Message                string      `json:"message,omitempty"`
	Code                   string      `json:"code,omitempty"`
	StatusCode             int         `json:"statusCode,omitempty"`
	Details                interface{} `json:"details,omitempty"`
	SkippedRestrictedItems bool        `json:"skippedRestrictedItems,omitempty"`
}

type lifecycleBatchResult struct {
	Items []lifecycleItemResult `json:"items"`
}

type lifecycleActionResult struct {
	ID                     string
	SourceID               string
	SkippedRestrictedItems bool
}

type lifecycleBatchSelection[T any] struct {
	index     int
	reference string
	item      T
	id        string
}

type lifecycleResolution[T any] struct {
	item T
	err  error
}

type folderBatchOutcome struct {
	includedIn string
	blockedBy  string
	withheldBy string
}

func lifecycleFailureItem(reference, id, sourceID string, err error) lifecycleItemResult {
	item := lifecycleItemResult{
		Reference: reference,
		SourceID:  sourceID,
		ID:        id,
		Status:    "failed",
		Message:   err.Error(),
	}
	var commandErr *cliError
	if errors.As(err, &commandErr) {
		item.Code = commandErr.Code
		item.StatusCode = commandErr.StatusCode
		item.Details = commandErr.Details
	}
	return item
}

func lifecycleMutationOutcomeUncertain(err error) bool {
	var requestError *cliError
	return errors.Is(err, context.DeadlineExceeded) ||
		errorCode(err) == "network_error" ||
		errorCode(err) == "invalid_response" ||
		(errors.As(err, &requestError) &&
			requestError.StatusCode >= http.StatusInternalServerError &&
			requestError.StatusCode <= 599)
}

func uncertainLifecycleMutationOutcome(err error) error {
	if !lifecycleMutationOutcomeUncertain(err) {
		return err
	}
	return &cliError{
		Code:    "outcome_uncertain",
		Message: "mutation outcome is uncertain; inspect before retrying",
		Cause:   err,
	}
}

func lifecycleOutcomeUncertainItem(reference, id, sourceID string, err error) lifecycleItemResult {
	item := lifecycleFailureItem(reference, id, sourceID, err)
	item.Status = "outcome_uncertain"
	item.Message = uncertainLifecycleMutationOutcome(err).Error()
	return item
}

func confirmLifecycleAction(r *runtimeState, yes bool, title string) error {
	if yes {
		return nil
	}
	if !r.interactive() {
		return usageError("this command requires confirmation; pass --yes when terminal input is disabled")
	}
	confirmed := false
	form := huh.NewForm(huh.NewGroup(huh.NewConfirm().Title(title).Value(&confirmed)))
	if err := form.WithInput(r.stdin).WithOutput(r.stderr).RunWithContext(r.ctx); err != nil {
		return err
	}
	if !confirmed {
		return &cliError{Code: "aborted", Message: "operation cancelled"}
	}
	return nil
}

func finishLifecycleBatch(r *runtimeState, result lifecycleBatchResult) error {
	failed := false
	for _, item := range result.Items {
		if item.Status != "success" && item.Status != "skipped" {
			failed = true
		}
	}
	if r.cli.JSON {
		if failed {
			return &cliError{
				Code:       "lifecycle_partial_failure",
				Message:    "one or more items could not be processed",
				StatusCode: http.StatusConflict,
				Details:    result,
			}
		}
		return r.printJSON(result)
	}
	for _, item := range result.Items {
		switch item.Status {
		case "success":
			if item.SourceID != "" {
				if _, err := fmt.Fprintf(
					r.stdout,
					"%s\t%s\t%s\n",
					terminalText(item.SourceID),
					terminalText(item.ID),
					terminalText(item.Status),
				); err != nil {
					return err
				}
			} else if _, err := fmt.Fprintf(r.stdout, "%s\t%s\n", terminalText(item.ID), terminalText(item.Status)); err != nil {
				return err
			}
			if item.SkippedRestrictedItems {
				if _, err := fmt.Fprintln(r.stderr, "Warning: folder copied; some restricted items were skipped."); err != nil {
					return err
				}
			}
		case "skipped":
			if _, err := fmt.Fprintf(
				r.stdout,
				"%s\t%s\t%s\n",
				terminalText(item.ID),
				terminalText(item.Status),
				terminalText(item.Message),
			); err != nil {
				return err
			}
		default:
			if _, err := fmt.Fprintf(
				r.stderr,
				"%s\t%s\t%s\n",
				terminalText(item.Reference),
				terminalText(item.Status),
				terminalText(item.Message),
			); err != nil {
				return err
			}
		}
	}
	if failed {
		return &cliError{Code: "lifecycle_partial_failure", Message: "one or more items could not be processed", StatusCode: http.StatusConflict, Details: result}
	}
	return nil
}

func runPageLifecycleBatch(
	r *runtimeState,
	references []string,
	action func(*client, string) error,
) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	result, selected := resolveLifecycleBatch(references, r.resolvePage, func(item page) string {
		return item.ID
	})
	return runResolvedLifecycleBatch(r, c, result, selected, func(c *client, item page, id string) (lifecycleActionResult, error) {
		return lifecycleActionResult{}, action(c, id)
	})
}

func runFolderLifecycleBatch(
	r *runtimeState,
	references []string,
	action func(*client, string) (lifecycleActionResult, error),
) error {
	c, err := r.client()
	if err != nil {
		return err
	}
	result, selected := resolveLifecycleBatch(references, r.resolveFolder, func(item folder) string {
		return item.ID
	})
	selectedIDs := make(map[string]struct{}, len(selected))
	ancestorCache := make(map[string]folder, len(selected))
	for _, selection := range selected {
		selectedIDs[selection.id] = struct{}{}
		ancestorCache[selection.id] = selection.item
	}
	selectedAncestors := make(map[string]string, len(selected))
	pending := make([]lifecycleBatchSelection[folder], 0, len(selected))
	outcomes := make(map[string]folderBatchOutcome, len(selected))
	for _, selection := range selected {
		ancestorID, ancestryErr := selectedFolderAncestor(c, selection.item, selectedIDs, ancestorCache)
		if ancestryErr != nil {
			result.Items[selection.index] = lifecycleFailureItem(
				selection.reference,
				selection.id,
				"",
				fmt.Errorf("resolve selected folder ancestry: %w", ancestryErr),
			)
			outcomes[selection.id] = folderBatchOutcome{withheldBy: selection.id}
			continue
		}
		selectedAncestors[selection.id] = ancestorID
		pending = append(pending, selection)
	}

	for len(pending) > 0 {
		next := make([]lifecycleBatchSelection[folder], 0, len(pending))
		progressed := false
		for _, selection := range pending {
			ancestorID := selectedAncestors[selection.id]
			if ancestorID == "" {
				item := runResolvedLifecycleSelection(&result, c, selection, func(c *client, item folder, id string) (lifecycleActionResult, error) {
					return action(c, id)
				})
				outcomes[selection.id] = folderBatchOutcomeForItem(selection.id, item)
				progressed = true
				continue
			}

			ancestorOutcome, completed := outcomes[ancestorID]
			if !completed {
				next = append(next, selection)
				continue
			}
			if ancestorOutcome.includedIn != "" {
				result.Items[selection.index] = lifecycleItemResult{
					Reference: selection.reference,
					ID:        selection.id,
					Status:    "skipped",
					Message:   fmt.Sprintf("included in selected folder %s", ancestorOutcome.includedIn),
				}
				outcomes[selection.id] = ancestorOutcome
			} else if ancestorOutcome.blockedBy != "" {
				result.Items[selection.index] = lifecycleItemResult{
					Reference: selection.reference,
					ID:        selection.id,
					Status:    "skipped",
					Message:   fmt.Sprintf("blocked by uncertain ancestor outcome for folder %s; inspect before retrying", ancestorOutcome.blockedBy),
				}
				outcomes[selection.id] = ancestorOutcome
			} else if ancestorOutcome.withheldBy != "" {
				result.Items[selection.index] = lifecycleItemResult{
					Reference: selection.reference,
					ID:        selection.id,
					Status:    "failed",
					Message: fmt.Sprintf(
						"withheld because selected folder %s ancestry could not be resolved",
						ancestorOutcome.withheldBy,
					),
				}
				outcomes[selection.id] = ancestorOutcome
			} else {
				item := runResolvedLifecycleSelection(&result, c, selection, func(c *client, item folder, id string) (lifecycleActionResult, error) {
					return action(c, id)
				})
				outcomes[selection.id] = folderBatchOutcomeForItem(selection.id, item)
			}
			progressed = true
		}
		if !progressed {
			for _, selection := range pending {
				result.Items[selection.index] = lifecycleFailureItem(
					selection.reference,
					selection.id,
					"",
					errors.New("could not determine selected folder execution order"),
				)
			}
			break
		}
		pending = next
	}
	return finishLifecycleBatch(r, result)
}

func folderBatchOutcomeForItem(folderID string, item lifecycleItemResult) folderBatchOutcome {
	switch item.Status {
	case "success":
		return folderBatchOutcome{includedIn: folderID}
	case "outcome_uncertain":
		return folderBatchOutcome{blockedBy: folderID}
	default:
		return folderBatchOutcome{}
	}
}

func resolveLifecycleBatch[T any](
	references []string,
	resolve func(string) (T, error),
	id func(T) string,
) (lifecycleBatchResult, []lifecycleBatchSelection[T]) {
	result := lifecycleBatchResult{Items: make([]lifecycleItemResult, len(references))}
	selected := make([]lifecycleBatchSelection[T], 0, len(references))
	resolvedByReference := make(map[string]lifecycleResolution[T], len(references))
	selectedIDs := make(map[string]struct{}, len(references))
	for index, reference := range references {
		resolved, ok := resolvedByReference[reference]
		if !ok {
			item, err := resolve(reference)
			resolved = lifecycleResolution[T]{item: item, err: err}
			resolvedByReference[reference] = resolved
		}
		if resolved.err != nil {
			result.Items[index] = lifecycleFailureItem(reference, "", "", resolved.err)
			continue
		}
		itemID := id(resolved.item)
		if _, duplicate := selectedIDs[itemID]; duplicate {
			result.Items[index] = lifecycleItemResult{
				Reference: reference,
				ID:        itemID,
				Status:    "skipped",
				Message:   "duplicate selection; included once",
			}
			continue
		}
		selectedIDs[itemID] = struct{}{}
		selected = append(selected, lifecycleBatchSelection[T]{
			index:     index,
			reference: reference,
			item:      resolved.item,
			id:        itemID,
		})
	}
	return result, selected
}

func runResolvedLifecycleBatch[T any](
	r *runtimeState,
	c *client,
	result lifecycleBatchResult,
	selected []lifecycleBatchSelection[T],
	action func(*client, T, string) (lifecycleActionResult, error),
) error {
	for _, selection := range selected {
		runResolvedLifecycleSelection(&result, c, selection, action)
	}
	return finishLifecycleBatch(r, result)
}

func runResolvedLifecycleSelection[T any](
	result *lifecycleBatchResult,
	c *client,
	selection lifecycleBatchSelection[T],
	action func(*client, T, string) (lifecycleActionResult, error),
) lifecycleItemResult {
	actionResult, actionErr := action(c, selection.item, selection.id)
	if actionErr != nil {
		if lifecycleMutationOutcomeUncertain(actionErr) {
			result.Items[selection.index] = lifecycleOutcomeUncertainItem(
				selection.reference,
				selection.id,
				actionResult.SourceID,
				actionErr,
			)
		} else {
			result.Items[selection.index] = lifecycleFailureItem(
				selection.reference,
				selection.id,
				actionResult.SourceID,
				actionErr,
			)
		}
		return result.Items[selection.index]
	}
	resultID := actionResult.ID
	if resultID == "" {
		resultID = selection.id
	}
	result.Items[selection.index] = lifecycleItemResult{
		Reference:              selection.reference,
		SourceID:               actionResult.SourceID,
		ID:                     resultID,
		Status:                 "success",
		SkippedRestrictedItems: actionResult.SkippedRestrictedItems,
	}
	return result.Items[selection.index]
}

func selectedFolderAncestor(
	c *client,
	item folder,
	selectedIDs map[string]struct{},
	cache map[string]folder,
) (string, error) {
	visited := map[string]struct{}{item.ID: {}}
	parentID := item.ParentID
	for parentID != nil {
		if _, selected := selectedIDs[*parentID]; selected {
			return *parentID, nil
		}
		if _, seen := visited[*parentID]; seen {
			return "", fmt.Errorf("folder hierarchy contains a cycle at %s", *parentID)
		}
		visited[*parentID] = struct{}{}
		parent, ok := cache[*parentID]
		if !ok {
			var err error
			parent, err = c.getFolder(*parentID)
			if err != nil {
				return "", err
			}
			cache[parent.ID] = parent
		}
		parentID = parent.ParentID
	}
	return "", nil
}
