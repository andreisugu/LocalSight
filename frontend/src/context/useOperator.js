// Active operator: the role that is signed in and the display name typed in the header.
//
// A role switch clears the custom name (the old name belonged to the old role) and says so
// in a toast. The name itself is persisted by `utils/operatorName.js`.

import { useMemo, useState } from 'react';
import { AVAILABLE_OPERATORS } from '../constants/mockData.js';
import { readStoredOperatorName, writeStoredOperatorName } from '../utils/operatorName.js';

const DEFAULT_OPERATOR_ID = 'dispatcher';

function browserStorage() {
  try {
    return window.localStorage;
  } catch {
    // No storage (disabled cookies, some private modes): the name lives for the session.
    return null;
  }
}

export function useOperator({ showToast }) {
  const [operatorId, setOperatorId] = useState(DEFAULT_OPERATOR_ID);
  const activeOperator = useMemo(
    () => AVAILABLE_OPERATORS.find((operator) => operator.id === operatorId) || AVAILABLE_OPERATORS[0],
    [operatorId]
  );
  const [customOperatorName, setCustomOperatorName] = useState(
    () => readStoredOperatorName(browserStorage())
  );
  const operatorName = customOperatorName || activeOperator.name;

  const setOperatorName = (name) => {
    setCustomOperatorName(writeStoredOperatorName(browserStorage(), name));
  };

  const switchOperator = (id) => {
    setOperatorId(id);
    setOperatorName('');
    const selected = AVAILABLE_OPERATORS.find((operator) => operator.id === id);
    if (selected) {
      showToast(`Sesiune activă comutată pe: ${selected.name} (${selected.role})`);
    }
  };

  return {
    operatorId,
    activeOperator,
    availableOperators: AVAILABLE_OPERATORS,
    operatorName,
    setOperatorName,
    switchOperator,
  };
}
