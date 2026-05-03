import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

export type SelectionItem = {
  id: string;
  type: 'page' | 'folder';
};

interface SelectionContextType {
  selectedItems: SelectionItem[];
  selectedCount: number;
  select: (item: SelectionItem) => void;
  deselect: (id: string) => void;
  toggle: (item: SelectionItem) => void;
  selectAll: (items: SelectionItem[]) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

const SelectionContext = createContext<SelectionContextType | undefined>(undefined);

export function SelectionProvider({ children }: { children: ReactNode }) {
  const [selectedItems, setSelectedItems] = useState<SelectionItem[]>([]);

  const select = useCallback((item: SelectionItem) => {
    setSelectedItems((prev) => {
      if (prev.some((i) => i.id === item.id)) return prev;
      return [...prev, item];
    });
  }, []);

  const deselect = useCallback((id: string) => {
    setSelectedItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toggle = useCallback((item: SelectionItem) => {
    setSelectedItems((prev) => {
      const exists = prev.some((i) => i.id === item.id);
      if (exists) {
        return prev.filter((i) => i.id !== item.id);
      }
      return [...prev, item];
    });
  }, []);

  const selectAll = useCallback((items: SelectionItem[]) => {
    setSelectedItems(items);
  }, []);

  const clear = useCallback(() => {
    setSelectedItems([]);
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedItems.some((item) => item.id === id),
    [selectedItems],
  );

  const value = useMemo(
    () => ({
      selectedItems,
      selectedCount: selectedItems.length,
      select,
      deselect,
      toggle,
      selectAll,
      clear,
      isSelected,
    }),
    [selectedItems, select, deselect, toggle, selectAll, clear, isSelected],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection() {
  const context = useContext(SelectionContext);
  if (context === undefined) {
    throw new Error('useSelection must be used within a SelectionProvider');
  }
  return context;
}
