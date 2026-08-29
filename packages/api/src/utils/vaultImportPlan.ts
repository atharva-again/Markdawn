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
    if (kind === 'image') {
      plan.files.push(file);
      plan.imageFiles.push(file);
      continue;
    }
    if (kind === 'unsupported-image') {
      plan.unsupportedImageFiles.push(file);
    }
  }

  return plan;
}
