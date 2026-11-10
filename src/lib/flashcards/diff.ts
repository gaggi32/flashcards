export type DiffPart = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

function charsEqual(a: string, b: string): boolean {
  return a === b || a.toLowerCase() === b.toLowerCase();
}

function tokensEqual(a: string, b: string): boolean {
  if (a === b) return true;
  if (/^\s+$/.test(a) && /^\s+$/.test(b)) return true;
  return a.toLowerCase() === b.toLowerCase();
}

// Internal char diff
function diffChars(oldStr: string, newStr: string): DiffPart[] {
  const m = oldStr.length;
  const n = newStr.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (charsEqual(oldStr[i - 1], newStr[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const ops = [];
  while (i > 0 && j > 0) {
    if (charsEqual(oldStr[i - 1], newStr[j - 1])) {
      ops.unshift({ type: 'equal', char: newStr[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      ops.unshift({ type: 'removed', char: oldStr[i - 1] });
      i--;
    } else {
      ops.unshift({ type: 'added', char: newStr[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.unshift({ type: 'removed', char: oldStr[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.unshift({ type: 'added', char: newStr[j - 1] });
    j--;
  }

  const result: DiffPart[] = [];
  for (const op of ops) {
    const last = result[result.length - 1];
    const isAdded = op.type === 'added';
    const isRemoved = op.type === 'removed';
    if (last && !!last.added === isAdded && !!last.removed === isRemoved) {
      last.value += op.char;
    } else {
      result.push({
        value: op.char,
        ...(isAdded ? { added: true } : {}),
        ...(isRemoved ? { removed: true } : {}),
      });
    }
  }
  return result;
}

export function computeDiff(oldStr: string, newStr: string): DiffPart[] {
  // Tokenize by word boundaries (spaces and non-spaces)
  const oldTokens = oldStr.match(/(\s+|[^\s]+)/g) || [];
  const newTokens = newStr.match(/(\s+|[^\s]+)/g) || [];

  const m = oldTokens.length;
  const n = newTokens.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (tokensEqual(oldTokens[i - 1], newTokens[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = m;
  let j = n;
  const ops = [];
  while (i > 0 && j > 0) {
    if (tokensEqual(oldTokens[i - 1], newTokens[j - 1])) {
      ops.unshift({ type: 'equal', token: newTokens[j - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      ops.unshift({ type: 'removed', token: oldTokens[i - 1] });
      i--;
    } else {
      ops.unshift({ type: 'added', token: newTokens[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    ops.unshift({ type: 'removed', token: oldTokens[i - 1] });
    i--;
  }
  while (j > 0) {
    ops.unshift({ type: 'added', token: newTokens[j - 1] });
    j--;
  }

  const result: DiffPart[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].type === 'equal') {
      result.push({ value: ops[k].token });
    } else {
      const removedTokens = [];
      const addedTokens = [];
      while (k < ops.length && ops[k].type !== 'equal') {
        if (ops[k].type === 'removed') removedTokens.push(ops[k].token);
        if (ops[k].type === 'added') addedTokens.push(ops[k].token);
        k++;
      }
      k--; 

      const removedStr = removedTokens.join('');
      const addedStr = addedTokens.join('');
      
      const charDiffs = diffChars(removedStr, addedStr);
      result.push(...charDiffs);
    }
  }
  
  const merged: DiffPart[] = [];
  for (const part of result) {
    const last = merged[merged.length - 1];
    if (last && !!last.added === !!part.added && !!last.removed === !!part.removed) {
      last.value += part.value;
    } else {
      merged.push({ ...part });
    }
  }

  return merged;
}
