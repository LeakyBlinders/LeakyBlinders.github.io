const MAX28 = 0xfffffff;

function toSysex(n) {
  const value = Math.max(0, Math.min(MAX28, Math.round(n)));
  return [(value >>> 21) & 0x7f, (value >>> 14) & 0x7f, (value >>> 7) & 0x7f, value & 0x7f];
}

function fromSysex(bytes) {
  return (
    ((bytes[0] & 0x7f) << 21) |
    ((bytes[1] & 0x7f) << 14) |
    ((bytes[2] & 0x7f) << 7) |
    (bytes[3] & 0x7f)
  );
}

function fmtHex(n) {
  return (n & 0x7f).toString(16).toUpperCase().padStart(2, "0");
}

function fmtSx(bytes) {
  return bytes.map(fmtHex).join(" ");
}

function parseSx(s) {
  const raw = (s || "").trim();
  if (!raw) {
    return [0, 0, 0, 0];
  }

  const normalized = raw.replace(/[^0-9A-Fa-f]+/gi, " ").trim();
  if (!normalized) {
    return [0, 0, 0, 0];
  }

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const pairs = [];

  for (const token of tokens) {
    let t = token;
    if (t.length === 1) {
      pairs.push(`0${t}`);
      continue;
    }

    if (t.length % 2 === 1) {
      t = `0${t}`;
    }

    for (let index = 0; index < t.length; index += 2) {
      pairs.push(t.slice(index, index + 2));
    }
  }

  if (pairs.length === 0) {
    return [0, 0, 0, 0];
  }

  const selected = pairs.length > 4 ? pairs.slice(-4) : pairs.slice();
  while (selected.length < 4) {
    selected.unshift("00");
  }

  return selected.map((pair) => {
    const value = Number.parseInt(pair, 16);
    return Number.isNaN(value) ? 0 : Math.max(0, Math.min(0x7f, value));
  });
}

function wireGroup(groupId) {
  const sxEl = document.getElementById(`${groupId}-sx`);
  const decEl = document.getElementById(`${groupId}-dec`);

  sxEl.addEventListener("input", () => {
    decEl.value = fromSysex(parseSx(sxEl.value));
  });
  sxEl.addEventListener("blur", () => {
    const bytes = parseSx(sxEl.value);
    sxEl.value = fmtSx(bytes);
    decEl.value = fromSysex(bytes);
  });
  sxEl.addEventListener("focus", () => sxEl.select());

  decEl.addEventListener("input", () => {
    const value = Number.parseInt(decEl.value || "0", 10);
    if (!Number.isNaN(value) && value >= 0) {
      sxEl.value = fmtSx(toSysex(Math.min(MAX28, value)));
    }
  });
  decEl.addEventListener("focus", () => decEl.select());
}

function wireArray(prefix) {
  const checkbox = document.getElementById(`${prefix}-arr`);
  const label = document.getElementById(`${prefix}2-label`);
  const wrap = document.getElementById(`${prefix}-count-wrap`);
  checkbox.addEventListener("change", () => {
    if (document.getElementById("calc-op-item").checked) {
      return;
    }
    label.textContent = checkbox.checked ? "Item Size" : "Val 2";
    wrap.classList.toggle("hidden", !checkbox.checked);
  });
}

function syncCalcOpUI() {
  const item = document.getElementById("calc-op-item").checked;
  const checkbox = document.getElementById("m-arr");
  const wrap = document.getElementById("m-count-wrap");
  const label = document.getElementById("m2-label");
  const arrWrap = document.getElementById("m-arr-wrap");
  const btn = document.getElementById("calc-btn");
  const replaceWrap = document.getElementById("replace-val-wrap");

  if (!item) {
    document.getElementById("m-rem").textContent = "";
  }

  if (item) {
    checkbox.checked = true;
    checkbox.disabled = true;
    arrWrap.classList.add("arr-label--locked");
    wrap.classList.remove("hidden");
    label.textContent = "Val 2";
    btn.textContent = "Compute";
    replaceWrap.classList.add("hidden");
  } else {
    checkbox.disabled = false;
    arrWrap.classList.remove("arr-label--locked");
    label.textContent = checkbox.checked ? "Item Size" : "Val 2";
    wrap.classList.toggle("hidden", !checkbox.checked);
    btn.textContent = document.getElementById("calc-op-sub").checked ? "Subtract" : "Add";
    replaceWrap.classList.remove("hidden");
    document.getElementById("chain-add-replace").hidden = !document.getElementById("calc-op-add").checked;
    document.getElementById("chain-sub-replace").hidden = !document.getElementById("calc-op-sub").checked;
  }
}

function setResult(val) {
  document.getElementById("mr-sx").value = fmtSx(toSysex(val));
  document.getElementById("mr-dec").value = val;
}

function fmtQuot(q) {
  if (!Number.isFinite(q)) {
    return "0";
  }
  if (Number.isInteger(q)) {
    return String(q);
  }
  return q.toFixed(12).replace(/\.?0+$/, "");
}

function applyItemSizeResult(quot) {
  const rounded = Math.round(Math.min(MAX28, Math.max(0, quot)));
  document.getElementById("mr-sx").value = fmtSx(toSysex(rounded));
  document.getElementById("mr-dec").value = fmtQuot(quot);
}

function readDec(groupId) {
  const value = Number.parseInt(document.getElementById(`${groupId}-dec`).value || "0", 10);
  return Number.isNaN(value) ? 0 : Math.max(0, value);
}

function prependLog(entry) {
  const textarea = document.getElementById("tickertape");
  const current = textarea.value.trim();
  textarea.value = current ? `${entry}\n\n${current}` : entry;
  textarea.scrollTop = 0;
}

function replaceVal1FromResult() {
  const raw = document.getElementById("mr-dec").value;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) {
    return;
  }
  const rounded = Math.max(0, Math.min(MAX28, Math.round(value)));
  document.getElementById("m1-dec").value = rounded;
  document.getElementById("m1-sx").value = fmtSx(toSysex(rounded));
}

function calculateAndReplaceVal1() {
  if (document.getElementById("calc-op-item").checked) {
    return;
  }
  calculate("add");
  replaceVal1FromResult();
}

function subtractAndReplaceVal1() {
  if (document.getElementById("calc-op-item").checked) {
    return;
  }
  calculate("sub");
  replaceVal1FromResult();
}

function calculate(forceOp) {
  const errEl = document.getElementById("m-err");
  const remEl = document.getElementById("m-rem");
  errEl.textContent = "";

  if (document.getElementById("calc-op-item").checked) {
    remEl.textContent = "";

    const v1Dec = readDec("m1");
    const v2Dec = readDec("m2");
    const v1Sx = document.getElementById("m1-sx").value || "00 00 00 00";
    const v2Sx = document.getElementById("m2-sx").value || "00 00 00 00";
    const count = Math.max(1, Number.parseInt(document.getElementById("m-count").value, 10) || 1);

    const diff = Math.abs(v1Dec - v2Dec);
    const quot = diff / count;
    const rem = diff % count;

    if (Math.round(quot) > MAX28) {
      errEl.textContent = `Overflow: sysex result clamped to ${MAX28}`;
    }

    applyItemSizeResult(quot);

    if (rem !== 0) {
      remEl.textContent = `Remainder ${rem}: |delta| = ${diff} is not divisible by ${count}`;
    }

    const resSx = fmtSx(toSysex(Math.round(Math.min(MAX28, Math.max(0, quot)))));
    let entry = `ITEM_SIZE  |${v1Sx} (${v1Dec}) - ${v2Sx} (${v2Dec})| = ${diff}  /  ${count}  =  ${resSx}  (${fmtQuot(quot)})`;
    if (rem !== 0) {
      entry += `\n  remainder ${rem} (not exact division)`;
    }

    prependLog(entry);
    return;
  }

  remEl.textContent = "";

  let isAdd;
  if (forceOp === "add") {
    isAdd = true;
  } else if (forceOp === "sub") {
    isAdd = false;
  } else {
    isAdd = document.getElementById("calc-op-add").checked;
  }

  const v1Dec = readDec("m1");
  const v1Sx = document.getElementById("m1-sx").value || "00 00 00 00";
  const v2Dec = readDec("m2");
  const v2Sx = document.getElementById("m2-sx").value || "00 00 00 00";
  const isArray = document.getElementById("m-arr").checked;
  const count = isArray ? Math.max(1, Number.parseInt(document.getElementById("m-count").value, 10) || 1) : 1;
  const v2Total = v2Dec * count;

  let resultValue;
  if (isAdd) {
    resultValue = v1Dec + v2Total;
    if (resultValue > MAX28) {
      errEl.textContent = `Overflow: clamped to ${MAX28}`;
      resultValue = MAX28;
    }
  } else {
    resultValue = v1Dec - v2Total;
    if (resultValue < 0) {
      errEl.textContent = "Underflow: clamped to 0";
      resultValue = 0;
    }
  }

  setResult(resultValue);

  const opSym = isAdd ? "+" : "-";
  const opWord = isAdd ? "ADD" : "SUB";
  const resSx = fmtSx(toSysex(resultValue));

  let v2str = `  ${opSym}  ${v2Sx}  (${v2Dec}`;
  if (isArray) {
    v2str += ` x ${count} = ${v2Total}`;
  }
  v2str += ")";

  const entry = `${opWord}  ${v1Sx}  (${v1Dec})\n${v2str}\n  =  ${resSx}  (${resultValue})`;

  prependLog(entry);
}

async function copyTape(btn, format) {
  const textarea = document.getElementById("tickertape");
  let text = textarea.value;
  if (format === "md") {
    text = `\`\`\`\n${text}\n\`\`\``;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    textarea.select();
    document.execCommand("copy");
  }
  btn.textContent = "Copied!";
  btn.classList.add("copied");
  window.setTimeout(() => {
    btn.textContent = format === "md" ? "Copy markdown" : "Copy text";
    btn.classList.remove("copied");
  }, 1200);
}

["m1", "m2"].forEach(wireGroup);
wireArray("m");

document.getElementById("calc-op-add").addEventListener("change", syncCalcOpUI);
document.getElementById("calc-op-sub").addEventListener("change", syncCalcOpUI);
document.getElementById("calc-op-item").addEventListener("change", syncCalcOpUI);
document.getElementById("calc-btn").addEventListener("click", () => calculate());
document.getElementById("chain-add-replace").addEventListener("click", calculateAndReplaceVal1);
document.getElementById("chain-sub-replace").addEventListener("click", subtractAndReplaceVal1);
document.getElementById("copy-tape-text").addEventListener("click", (event) => copyTape(event.currentTarget, "text"));
document
  .getElementById("copy-tape-markdown")
  .addEventListener("click", (event) => copyTape(event.currentTarget, "md"));
syncCalcOpUI();
