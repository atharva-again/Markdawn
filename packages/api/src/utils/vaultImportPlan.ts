import { isImageFile } from './obsidian-parsers';
import { getVaultImportKind, type VaultImportFile } from './vaultImportValidation';

export type { VaultImportFile } from './vaultImportValidation';

export type VaultImportPlan = {
  files: VaultImportFile[];
  markdownFiles: VaultImportFile[];
  imageFiles: VaultImportFile[];
  unsupportedImageFiles: VaultImportFile[];
};

export function createVaultImportPlan(files: readonly VaultImportFile[]): VaultImportPlan {
  const plan: VaultImportPlan = {
    files: [],
    markdownFiles: [],
    imageFiles: [],
    unsupportedImageFiles: [],
  };

  for (const file of files) {
    const kind = getVaultImportKind(file.path);
    if (kind === 'markdown') {
      plan.files.push(file);
      plan.markdownFiles.push(file);
      continue;
    }
    if (isImageFile(file.path)) {
      if (kind !== 'image') {
        plan.unsupportedImageFiles.push(file);
        continue;
      }
      plan.files.push(file);
      plan.imageFiles.push(file);
    }
  }

  return plan;
}
