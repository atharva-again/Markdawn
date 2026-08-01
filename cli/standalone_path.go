package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"
)

func removePathBlock(path, installDir string) error {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return fmt.Errorf("resolve installer PATH file: %w", err)
	}
	data, err := os.ReadFile(resolvedPath)
	if err != nil {
		return fmt.Errorf("read installer PATH file: %w", err)
	}
	contents, encoding, err := decodeProfile(data)
	if err != nil {
		return fmt.Errorf("read installer PATH file: %w", err)
	}
	start, end, found, err := managedPathBlockRange(contents, installDir)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("remove installer PATH block: block for this installation was not found")
	}
	if strings.HasPrefix(contents[end:], "\r\n") {
		end += 2
	} else if end < len(contents) && contents[end] == '\n' {
		end++
	}
	encoded, err := encodeProfile(contents[:start]+contents[end:], encoding)
	if err != nil {
		return fmt.Errorf("encode installer PATH file: %w", err)
	}
	if err := writeStandalonePathProfile(resolvedPath, encoded); err != nil {
		return fmt.Errorf("remove installer PATH block: %w", err)
	}
	return nil
}

func managedPathBlockRange(contents, installDir string) (int, int, bool, error) {
	start := -1
	end := 0
	searchOffset := 0
	for {
		blockStartOffset := strings.Index(contents[searchOffset:], pathBlockStart)
		blockEndOffset := strings.Index(contents[searchOffset:], pathBlockEnd)
		if blockStartOffset < 0 && blockEndOffset < 0 {
			break
		}
		if blockEndOffset >= 0 && (blockStartOffset < 0 || blockEndOffset < blockStartOffset) {
			return 0, 0, false, fmt.Errorf("managed PATH block end marker has no matching start marker")
		}
		blockStart := searchOffset + blockStartOffset
		searchOffset = blockStart + len(pathBlockStart)
		blockEndOffset = strings.Index(contents[searchOffset:], pathBlockEnd)
		if blockEndOffset < 0 {
			return 0, 0, false, fmt.Errorf("managed PATH block is incomplete")
		}
		nestedStartOffset := strings.Index(contents[searchOffset:], pathBlockStart)
		if nestedStartOffset >= 0 && nestedStartOffset < blockEndOffset {
			return 0, 0, false, fmt.Errorf("managed PATH block is nested")
		}
		blockEnd := searchOffset + blockEndOffset + len(pathBlockEnd)
		if blockContainsInstallPath(contents[blockStart:blockEnd], installDir) {
			if start >= 0 {
				return 0, 0, false, fmt.Errorf("managed PATH blocks match this installation multiple times")
			}
			start, end = blockStart, blockEnd
		}
		searchOffset = blockEnd
	}
	return start, end, start >= 0, nil
}

func removePathBlockWithRollback(path, installDir string) (func() error, error) {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil {
		return nil, fmt.Errorf("resolve installer PATH file for rollback: %w", err)
	}
	original, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil, fmt.Errorf("read installer PATH file for rollback: %w", err)
	}
	if err := removePathBlock(path, installDir); err != nil {
		return nil, err
	}
	return func() error { return writeStandalonePathProfile(resolvedPath, original) }, nil
}

func blockContainsInstallPath(block, installDir string) bool {
	return strings.Contains(block, standalonePathEntry(installDir, "sh")) ||
		strings.Contains(block, standalonePathEntry(installDir, "fish")) ||
		strings.Contains(block, standalonePathEntry(installDir, "powershell")) ||
		// Keep recognition of blocks written by standalone CLI releases before
		// path entries were shell-escaped, so uninstall and upgrades remain safe.
		strings.Contains(block, "export PATH=\""+installDir+":$PATH\"") ||
		strings.Contains(block, "fish_add_path "+installDir)
}

type profileEncoding uint8

const (
	profileUTF8 profileEncoding = iota
	profileUTF16LE
	profileUTF16BE
)

func decodeProfile(data []byte) (string, profileEncoding, error) {
	if len(data) < 2 || !((data[0] == 0xff && data[1] == 0xfe) || (data[0] == 0xfe && data[1] == 0xff)) {
		if !utf8.Valid(data) {
			return "", profileUTF8, errors.New("invalid UTF-8")
		}
		return string(data), profileUTF8, nil
	}
	if len(data)%2 != 0 {
		return "", profileUTF8, errors.New("invalid UTF-16 byte length")
	}
	encoding := profileUTF16LE
	var order binary.ByteOrder = binary.LittleEndian
	if data[0] == 0xfe {
		encoding = profileUTF16BE
		order = binary.BigEndian
	}
	units := make([]uint16, (len(data)-2)/2)
	for index := range units {
		units[index] = order.Uint16(data[2+index*2:])
	}
	for index, unit := range units {
		if unit >= 0xd800 && unit <= 0xdbff {
			if index+1 >= len(units) || units[index+1] < 0xdc00 || units[index+1] > 0xdfff {
				return "", profileUTF8, errors.New("invalid UTF-16 surrogate pair")
			}
		} else if unit >= 0xdc00 && unit <= 0xdfff && (index == 0 || units[index-1] < 0xd800 || units[index-1] > 0xdbff) {
			return "", profileUTF8, errors.New("invalid UTF-16 surrogate pair")
		}
	}
	return string(utf16.Decode(units)), encoding, nil
}

func encodeProfile(contents string, encoding profileEncoding) ([]byte, error) {
	if encoding == profileUTF8 {
		return []byte(contents), nil
	}
	units := utf16.Encode([]rune(contents))
	data := make([]byte, 2+len(units)*2)
	if encoding == profileUTF16LE {
		data[0], data[1] = 0xff, 0xfe
		for index, unit := range units {
			binary.LittleEndian.PutUint16(data[2+index*2:], unit)
		}
		return data, nil
	}
	if encoding == profileUTF16BE {
		data[0], data[1] = 0xfe, 0xff
		for index, unit := range units {
			binary.BigEndian.PutUint16(data[2+index*2:], unit)
		}
		return data, nil
	}
	return nil, errors.New("unsupported profile encoding")
}

func writeFileAtomically(path string, contents []byte) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	temporaryFile, err := os.CreateTemp(filepath.Dir(path), "."+filepath.Base(path)+".*")
	if err != nil {
		return err
	}
	temporaryPath := temporaryFile.Name()
	defer os.Remove(temporaryPath)
	if err := temporaryFile.Chmod(info.Mode().Perm()); err != nil {
		temporaryFile.Close()
		return err
	}
	if _, err := temporaryFile.Write(contents); err != nil {
		temporaryFile.Close()
		return err
	}
	if err := temporaryFile.Sync(); err != nil {
		temporaryFile.Close()
		return err
	}
	if err := temporaryFile.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}
