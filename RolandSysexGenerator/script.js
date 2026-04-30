const COMMANDS = {
  dt1: "12",
  rq1: "11",
};

const form = document.querySelector("#sysex-form");
const dataField = document.querySelector("#data-field");
const sizeField = document.querySelector("#size-field");
const result = document.querySelector("#result");
const errorOutput = document.querySelector("#error-output");
const copyButton = document.querySelector("#copy-result");
const clearResultButton = document.querySelector("#clear-result");
const runButton = document.querySelector("#run-sysex");
const copyLinkButton = document.querySelector("#copy-link");
const midiInputSelect = document.querySelector("#midi-input");
const midiOutputSelect = document.querySelector("#midi-output");
const midiStatus = document.querySelector("#midi-status");
const replyOutput = document.querySelector("#reply-output");
const showRawInput = document.querySelector("#show-raw");
const showRawToggle = document.querySelector("#show-raw-toggle");
const modelIdInput = document.querySelector("#model-id");
const modelIdPresetSelect = document.querySelector("#model-id-preset");
const viewTabs = document.querySelectorAll(".view-tab");
const viewPanels = document.querySelectorAll("[data-view-panel]");

const MIDI_INPUT_STORAGE_KEY = "rolandSysexMidiInputId";
const MIDI_OUTPUT_STORAGE_KEY = "rolandSysexMidiOutputId";

/** Default when #reply-timeout-ms is empty or missing. @see getReplyWaitMs */
const DEFAULT_REPLY_WAIT_MS = 100;

/** Model ID, start/step address, and RQ1 size: 3–5 hex bytes (width follows Start Address for model/step/size). */
const HEX_ADDR_ID_OPTS = { minLength: 3, maxLength: 5 };

let midiAccess;
let midiAccessPromise;

function setActiveView(view) {
  const selectedView = view === "calculator" ? "calculator" : "sysex";
  viewTabs.forEach((tab) => {
    const active = tab.dataset.view === selectedView;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-current", active ? "page" : "false");
  });
  viewPanels.forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.viewPanel !== selectedView);
  });
}

function extractHexDigitString(value) {
  const stripped = String(value)
    .replace(/0x/gi, "")
    .replace(/h\b/gi, "");
  return stripped.replace(/[^0-9a-f]/gi, "");
}

function parseHexBytes(value, label, options = {}) {
  const { required = true, expectedLength, minLength, maxLength } = options;
  const digits = extractHexDigitString(value);

  if (!digits) {
    if (required) {
      throw new Error(`${label} is required.`);
    }

    return [];
  }

  if (digits.length % 2 !== 0) {
    throw new Error(`${label} has an incomplete hex byte (odd number of hex digits).`);
  }

  const bytes = [];
  for (let index = 0; index < digits.length; index += 2) {
    const token = digits.slice(index, index + 2);
    const byte = Number.parseInt(token, 16);
    if (byte > 0x7f) {
      throw new Error(`${label} byte "${token}" is outside Roland's 00-7F data range.`);
    }

    bytes.push(byte);
  }

  if (expectedLength !== undefined && bytes.length !== expectedLength) {
    throw new Error(`${label} must contain ${expectedLength} hex bytes.`);
  }

  if (minLength !== undefined && bytes.length < minLength) {
    throw new Error(`${label} must contain at least ${minLength} hex bytes.`);
  }

  if (maxLength !== undefined && bytes.length > maxLength) {
    throw new Error(`${label} must contain no more than ${maxLength} hex bytes.`);
  }

  return bytes;
}

function parsePositiveInteger(value, label) {
  return parseWholeNumber(value, label, { min: 1 });
}

function parseWholeNumber(value, label, { min = 0 } = {}) {
  const raw = String(value).trim();
  const parsed = Number.parseInt(raw, 10);

  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(parsed) || parsed < min) {
    const requirement = min > 0 ? "positive" : "non-negative";
    throw new Error(`${label} must be a ${requirement} whole number.`);
  }

  return parsed;
}

function parseHexInteger(value, label, { min = 0 } = {}) {
  const digits = extractHexDigitString(value);
  if (!digits) {
    throw new Error(`${label} is required.`);
  }

  const parsed = Number.parseInt(digits, 16);
  if (!Number.isSafeInteger(parsed) || parsed < min) {
    const requirement = min > 0 ? "positive" : "non-negative";
    throw new Error(`${label} must be a ${requirement} whole number.`);
  }

  return parsed;
}

function getReplyWaitMs() {
  const el = form.elements["reply-timeout-ms"];
  const raw = el && "value" in el ? String(el.value).trim() : "";
  const parsed = raw === "" ? DEFAULT_REPLY_WAIT_MS : Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("Reply wait (ms) must be a positive whole number.");
  }
  if (parsed > 300000) {
    throw new Error("Reply wait (ms) must be at most 300000.");
  }
  return parsed;
}

function formatReplyWaitLabel(ms) {
  if (ms < 1000) {
    return `${ms} ms`;
  }
  const seconds = ms / 1000;
  return Number.isInteger(seconds) ? `${seconds} s` : `${seconds.toFixed(1)} s`;
}

function bytesToNumber(bytes) {
  return bytes.reduce((total, byte) => total * 0x80 + byte, 0);
}

function numberToBytes(value, length) {
  if (value < 0) {
    throw new Error("Address calculation went below 00 00 00 00.");
  }

  const bytes = Array.from({ length }, () => 0);
  let remaining = value;

  for (let index = length - 1; index >= 0; index -= 1) {
    bytes[index] = remaining % 0x80;
    remaining = Math.floor(remaining / 0x80);
  }

  if (remaining > 0) {
    throw new Error("Address calculation exceeded the available address length.");
  }

  return bytes;
}

function checksum(bytes) {
  const total = bytes.reduce((sum, byte) => sum + byte, 0);
  return (128 - (total % 128)) % 128;
}

function formatByte(byte) {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

function formatPacket(bytes) {
  return bytes.map(formatByte).join(" ");
}

function formatHexInteger(value) {
  return value.toString(16).toUpperCase();
}

function getCurrentAddressLength(fallback = 4) {
  try {
    return parseHexBytes(form.elements["start-address"].value, "Start Address", HEX_ADDR_ID_OPTS).length;
  } catch {
    const digitLength = extractHexDigitString(form.elements["start-address"].value).length;
    const byteLength = Math.ceil(digitLength / 2);
    return byteLength >= HEX_ADDR_ID_OPTS.minLength && byteLength <= HEX_ADDR_ID_OPTS.maxLength
      ? byteLength
      : fallback;
  }
}

function setupByteDecimalPair({ hexId, decimalId, label, parseOptions, getByteLength }) {
  const hexInput = document.querySelector(`#${hexId}`);
  const decimalInput = document.querySelector(`#${decimalId}`);
  const resolvedParseOptions = () =>
    typeof parseOptions === "function" ? parseOptions() : parseOptions;

  function syncDecimalFromHex() {
    try {
      const bytes = parseHexBytes(hexInput.value, label, resolvedParseOptions());
      decimalInput.value = String(bytesToNumber(bytes));
    } catch {
      decimalInput.value = "";
    }
  }

  function syncHexFromDecimal() {
    if (String(decimalInput.value).trim() === "") {
      hexInput.value = "";
      return;
    }

    try {
      const value = parseWholeNumber(decimalInput.value, label);
      hexInput.value = formatPacket(numberToBytes(value, getByteLength()));
    } catch {
      hexInput.value = "";
    }
  }

  hexInput.addEventListener("input", syncDecimalFromHex);
  decimalInput.addEventListener("input", syncHexFromDecimal);

  return syncDecimalFromHex;
}

function setupRequestCountDecimalPair() {
  const hexInput = document.querySelector("#request-count-hex");
  const decimalInput = document.querySelector("#request-count");

  function syncDecimalFromHex() {
    try {
      decimalInput.value = String(parseHexInteger(hexInput.value, "# Requests", { min: 1 }));
    } catch {
      decimalInput.value = "";
    }
  }

  function syncHexFromDecimal() {
    if (String(decimalInput.value).trim() === "") {
      hexInput.value = "";
      return;
    }

    try {
      hexInput.value = formatHexInteger(parsePositiveInteger(decimalInput.value, "# Requests"));
    } catch {
      hexInput.value = "";
    }
  }

  hexInput.addEventListener("input", syncDecimalFromHex);
  decimalInput.addEventListener("input", syncHexFromDecimal);
  hexInput.addEventListener("blur", () => {
    if (hexInput.value) {
      syncHexFromDecimal();
    }
  });

  return syncHexFromDecimal;
}

function validateDeviceId(deviceId) {
  if ((deviceId < 0x10 || deviceId > 0x1f) && deviceId !== 0x7f) {
    throw new Error("Device ID must be 10-1F or 7F.");
  }
}

function buildPacket({ deviceId, modelId, command, address, payload }) {
  const check = checksum([...address, ...payload]);
  return [0xf0, 0x41, deviceId, ...modelId, command, ...address, ...payload, check, 0xf7];
}

function getSelectedValue(name) {
  return new FormData(form).get(name);
}

function getMessageShape() {
  const startAddress = parseHexBytes(form.elements["start-address"].value, "Start Address", HEX_ADDR_ID_OPTS);
  const addressLength = startAddress.length;
  const modelId = parseHexBytes(form.elements["model-id"].value, "Model ID", {
    ...HEX_ADDR_ID_OPTS,
    expectedLength: addressLength,
  });

  return {
    addressLength,
    modelId,
    startAddress,
  };
}

/** Query keys for shareable / restorable app state (excludes Web MIDI port picks). */
const SHARE_QUERY_KEYS = [
  "device-id",
  "model-id",
  "start-address",
  "request-count",
  "address-step",
  "address-direction",
  "message-type",
  "data-bytes",
  "request-size",
  "reply-timeout-ms",
  "show-raw",
];

function getShareableFormValue(name) {
  const el = form.elements[name];
  if (el instanceof RadioNodeList) {
    const checked = form.querySelector(`input[name="${name}"]:checked`);
    return checked ? checked.value : "";
  }
  return el && "value" in el ? el.value : "";
}

function buildShareQueryParams() {
  const params = new URLSearchParams();
  for (const key of SHARE_QUERY_KEYS) {
    params.set(key, getShareableFormValue(key));
  }
  return params;
}

function buildShareUrl() {
  const url = new URL(window.location.href);
  url.search = buildShareQueryParams().toString();
  return url.toString();
}

function normalizeShowRawParam(value) {
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" ? "1" : "0";
}

function syncShowRawToggleFromInput() {
  const on = showRawInput.value === "1";
  showRawToggle.setAttribute("aria-pressed", on ? "true" : "false");
  showRawToggle.textContent = on ? "Hide raw" : "Show raw";
}

function setShowRaw(on) {
  showRawInput.value = on ? "1" : "0";
  syncShowRawToggleFromInput();
  const url = buildShareUrl();
  history.replaceState(null, "", url);
}

function applyShareParamsFromUrl() {
  const params = new URLSearchParams(window.location.search);
  let found = false;
  for (const key of SHARE_QUERY_KEYS) {
    if (!params.has(key)) {
      continue;
    }
    found = true;
    const value = params.get(key);
    const el = form.elements[key];
    if (el instanceof RadioNodeList) {
      for (const radio of form.querySelectorAll(`input[type="radio"][name="${key}"]`)) {
        radio.checked = radio.value === value;
      }
    } else if (el && "value" in el) {
      el.value = key === "show-raw" ? normalizeShowRawParam(value) : value;
    }
  }
  if (found) {
    updateMessageFields();
  }
  syncShowRawToggleFromInput();
}

function updateMessageFields() {
  const isRequest = getSelectedValue("message-type") === "rq1";
  dataField.classList.toggle("hidden", isRequest);
  sizeField.classList.toggle("hidden", !isRequest);
}

function generatePacketBytes() {
  const deviceId = parseHexBytes(form.elements["device-id"].value, "Device ID", {
    expectedLength: 1,
  })[0];
  validateDeviceId(deviceId);

  const { addressLength, modelId, startAddress } = getMessageShape();
  const addressStep = parseHexBytes(form.elements["address-step"].value, "Change Address By", {
    expectedLength: addressLength,
  });
  const requestCount = parsePositiveInteger(form.elements["request-count"].value, "# Requests");
  const messageType = getSelectedValue("message-type");
  const direction = getSelectedValue("address-direction") === "decrement" ? -1 : 1;
  const payload =
    messageType === "rq1"
      ? parseHexBytes(form.elements["request-size"].value, "Bytes to Request", {
          expectedLength: addressLength,
        })
      : parseHexBytes(form.elements["data-bytes"].value, "Data to Set");
  const start = bytesToNumber(startAddress);
  const step = bytesToNumber(addressStep) * direction;
  const packets = [];

  for (let index = 0; index < requestCount; index += 1) {
    const address = numberToBytes(start + step * index, addressLength);
    const command = Number.parseInt(COMMANDS[messageType], 16);
    const chunks =
      messageType === "dt1" && payload.length > 256
        ? Array.from({ length: Math.ceil(payload.length / 256) }, (_, chunkIndex) =>
            payload.slice(chunkIndex * 256, chunkIndex * 256 + 256),
          )
        : [payload];

    chunks.forEach((chunk, chunkIndex) => {
      const chunkAddress =
        messageType === "dt1" && payload.length > 256
          ? numberToBytes(bytesToNumber(address) + chunkIndex * 256, addressLength)
          : address;
      const packet = buildPacket({
        deviceId,
        modelId,
        command,
        address: chunkAddress,
        payload: chunk,
      });

      packets.push(packet);
    });
  }

  return packets;
}

function generatePackets() {
  return generatePacketBytes().map(formatPacket);
}

function populateMidiSelect(select, ports, storageKey, emptyLabel) {
  const previousId = localStorage.getItem(storageKey);
  select.innerHTML = "";

  if (ports.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = emptyLabel;
    select.append(option);
    return;
  }

  ports.forEach((port) => {
    const option = document.createElement("option");
    option.value = port.id;
    option.textContent = port.name || `${port.manufacturer || "MIDI"} ${port.id}`;
    select.append(option);
  });

  const chosenId =
    previousId && ports.some((port) => port.id === previousId) ? previousId : ports[0].id;
  select.value = chosenId;
  localStorage.setItem(storageKey, chosenId);
}

function persistMidiPortSelections() {
  if (midiInputSelect.value) {
    localStorage.setItem(MIDI_INPUT_STORAGE_KEY, midiInputSelect.value);
  }
  if (midiOutputSelect.value) {
    localStorage.setItem(MIDI_OUTPUT_STORAGE_KEY, midiOutputSelect.value);
  }
}

function populateMidiPorts() {
  if (!midiAccess) {
    return;
  }

  const inputs = Array.from(midiAccess.inputs.values());
  const outputs = Array.from(midiAccess.outputs.values());

  populateMidiSelect(midiInputSelect, inputs, MIDI_INPUT_STORAGE_KEY, "No MIDI inputs found");
  populateMidiSelect(midiOutputSelect, outputs, MIDI_OUTPUT_STORAGE_KEY, "No MIDI outputs found");

  let status = `MIDI ready: ${inputs.length} input(s), ${outputs.length} output(s).`;
  if (inputs.length === 0 && outputs.length === 0) {
    status +=
      " No ports listed yet — confirm devices are connected, this page uses HTTPS or localhost, and the site is allowed MIDI + SysEx in browser settings.";
  }
  midiStatus.textContent = status;
}

function schedulePopulateMidiPortsRetries() {
  [0, 50, 150, 400, 1000].forEach((ms) => {
    window.setTimeout(() => {
      if (midiAccess) {
        populateMidiPorts();
      }
    }, ms);
  });
}

async function ensureMidiAccess() {
  if (midiAccess) {
    return midiAccess;
  }

  if (!navigator.requestMIDIAccess) {
    throw new Error("This browser does not support Web MIDI.");
  }

  if (!window.isSecureContext) {
    throw new Error("Web MIDI needs a secure context (HTTPS or http://localhost).");
  }

  if (!midiAccessPromise) {
    midiStatus.textContent = "Requesting MIDI access with sysex enabled...";
    midiAccessPromise = (async () => {
      const access = await navigator.requestMIDIAccess({ sysex: true });
      midiAccess = access;
      access.addEventListener("statechange", populateMidiPorts);
      populateMidiPorts();
      schedulePopulateMidiPortsRetries();
      return access;
    })().finally(() => {
      midiAccessPromise = null;
    });
  }

  return midiAccessPromise;
}

function getSelectedMidiPort(collection, selectedId, label) {
  const port = selectedId ? collection.get(selectedId) : undefined;

  if (!port) {
    throw new Error(`Select a MIDI ${label}.`);
  }

  return port;
}

function waitForReplies(input, timeoutMs, options = {}) {
  return new Promise((resolve) => {
    const { expectedPayloadBytes, modelId, addressLength } = options;
    const replies = [];
    let receivedPayloadBytes = 0;
    let settled = false;
    let timeoutId;

    function finish(timedOut) {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      input.removeEventListener("midimessage", handleMessage);
      resolve({
        expectedPayloadBytes,
        incomplete:
          Number.isInteger(expectedPayloadBytes) &&
          timedOut &&
          receivedPayloadBytes < expectedPayloadBytes,
        receivedPayloadBytes,
        replies,
      });
    }

    function resetTimer() {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => finish(true), timeoutMs);
    }

    function handleMessage(event) {
      const bytes = Array.from(event.data);
      if (bytes[0] === 0xf0 && bytes[bytes.length - 1] === 0xf7) {
        replies.push(bytes);

        if (Number.isInteger(expectedPayloadBytes)) {
          const parsed = parseDt1Reply(bytes, modelId, addressLength);
          if (!parsed.error) {
            receivedPayloadBytes += parsed.payload.length;
          }

          if (receivedPayloadBytes >= expectedPayloadBytes) {
            finish(false);
            return;
          }
        }

        resetTimer();
      }
    }

    input.addEventListener("midimessage", handleMessage);
    resetTimer();
  });
}

function extractRequestAddressFromSentPacket(packet, modelId, addressLength) {
  const commandIndex = 3 + modelId.length;
  const addressStart = commandIndex + 1;
  const end = addressStart + addressLength;
  if (packet.length < end) {
    return [];
  }
  return packet.slice(addressStart, end);
}

function parseDt1Reply(bytes, modelId, addressLength) {
  const commandIndex = 3 + modelId.length;
  const addressStart = commandIndex + 1;
  const payloadStart = addressStart + addressLength;
  const checksumIndex = bytes.length - 2;
  const hasExpectedHeader =
    bytes[0] === 0xf0 &&
    bytes[1] === 0x41 &&
    bytes[commandIndex] === 0x12 &&
    bytes[bytes.length - 1] === 0xf7;
  const hasExpectedModel = modelId.every((byte, index) => bytes[3 + index] === byte);

  if (!hasExpectedHeader || !hasExpectedModel || checksumIndex < payloadStart) {
    return {
      error: "Reply is not a DT1 message for the current model/address settings.",
    };
  }

  const address = bytes.slice(addressStart, payloadStart);
  const payload = bytes.slice(payloadStart, checksumIndex);
  const receivedChecksum = bytes[checksumIndex];
  const expectedChecksum = checksum([...address, ...payload]);

  return {
    address,
    expectedChecksum,
    payload,
    receivedChecksum,
  };
}

function isAsciiText(bytes) {
  return bytes.length > 0 && bytes.every((byte) => byte >= 32 && byte <= 127);
}

function buildReplyGroupCard(group, groupIndex, modelId, addressLength, replyWaitMs, showRaw) {
  const card = document.createElement("article");
  card.className = "reply-card";

  const title = document.createElement("strong");
  title.textContent = `Sent packet ${groupIndex + 1}`;
  card.append(title);

  const requestAddress = extractRequestAddressFromSentPacket(group.packet, modelId, addressLength);
  const requestAddrText = formatPacket(requestAddress);

  if (group.incomplete) {
    const incomplete = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = `Incomplete: received ${group.receivedPayloadBytes} of ${group.expectedPayloadBytes} requested bytes.`;
    incomplete.append(strong);
    card.append(incomplete);
  }

  if (group.replies.length === 0) {
    const empty = document.createElement("p");
    const strong = document.createElement("strong");
    strong.textContent = group.incomplete
      ? `Timed out after ${formatReplyWaitLabel(replyWaitMs)} without a complete reply.`
      : `No DT1 reply within ${formatReplyWaitLabel(replyWaitMs)}.`;
    empty.append(strong);
    card.append(empty);
    return card;
  }

  group.replies.forEach((reply, replyIndex) => {
    const parsed = parseDt1Reply(reply, modelId, addressLength);
    if (showRaw) {
      const raw = document.createElement("pre");
      raw.textContent = `Raw ${replyIndex + 1}: ${formatPacket(reply)}`;
      card.append(raw);
    }

    const detail = document.createElement("div");
    detail.className = "reply-detail";

    if (parsed.error) {
      const strong = document.createElement("strong");
      strong.textContent = parsed.error;
      detail.append(strong);
    } else {
      const checksumOk = parsed.receivedChecksum === parsed.expectedChecksum;
      const asciiText = isAsciiText(parsed.payload)
        ? `\nText: ${String.fromCharCode(...parsed.payload)}`
        : "";
      detail.append(
        `rq: ${requestAddrText}  rx: ${formatPacket(parsed.address)}\nLength: ${
          parsed.payload.length
        } bytes\nPayload: ${formatPacket(parsed.payload)}${asciiText}`,
      );
      if (!checksumOk) {
        const warn = document.createElement("strong");
        warn.textContent = `\nChecksum mismatch: received ${formatByte(parsed.receivedChecksum)} expected ${formatByte(
          parsed.expectedChecksum,
        )}`;
        detail.append(warn);
      }
    }

    card.append(detail);
  });

  return card;
}

async function runSysex() {
  errorOutput.textContent = "";
  replyOutput.textContent = "";
  runButton.disabled = true;
  runButton.textContent = "Running...";

  try {
    const packets = generatePacketBytes();
    const { addressLength, modelId } = getMessageShape();
    const replyWaitMs = getReplyWaitMs();
    const expectedPayloadBytes =
      getSelectedValue("message-type") === "rq1"
        ? bytesToNumber(
            parseHexBytes(form.elements["request-size"].value, "Bytes to Request", {
              expectedLength: addressLength,
            }),
          )
        : undefined;
    result.value = packets.map(formatPacket).join("\n");

    const access = await ensureMidiAccess();
    const input = getSelectedMidiPort(access.inputs, midiInputSelect.value, "input");
    const output = getSelectedMidiPort(access.outputs, midiOutputSelect.value, "output");

    const showRaw = showRawInput.value === "1";

    for (let index = 0; index < packets.length; index += 1) {
      const packet = packets[index];
      const pendingReplies = waitForReplies(input, replyWaitMs, {
        addressLength,
        expectedPayloadBytes,
        modelId,
      });
      output.send(packet);
      const replyGroup = await pendingReplies;
      const card = buildReplyGroupCard(
        { packet, ...replyGroup },
        index,
        modelId,
        addressLength,
        replyWaitMs,
        showRaw,
      );
      replyOutput.append(card);
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  } catch (error) {
    errorOutput.textContent = error.message;
  } finally {
    runButton.disabled = false;
    runButton.textContent = "Run Sysex";
  }
}

form.addEventListener("change", (event) => {
  if (event.target.name === "message-type") {
    updateMessageFields();
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  errorOutput.textContent = "";

  try {
    result.value = generatePackets().join("\n");
  } catch (error) {
    result.value = "";
    errorOutput.textContent = error.message;
  }
});

copyButton.addEventListener("click", async () => {
  if (!result.value) {
    return;
  }

  if (navigator.clipboard) {
    await navigator.clipboard.writeText(result.value);
  } else {
    result.select();
    document.execCommand("copy");
    result.blur();
  }

  copyButton.textContent = "Copied";
  window.setTimeout(() => {
    copyButton.textContent = "Copy Result";
  }, 1200);
});

clearResultButton.addEventListener("click", () => {
  replyOutput.textContent = "";
});

function formatHexFieldOnBlur(element, label, parseOptions) {
  const digits = extractHexDigitString(element.value);
  if (!digits) {
    element.value = "";
    return;
  }

  try {
    element.value = formatPacket(parseHexBytes(element.value, label, { ...parseOptions, required: true }));
  } catch {
    /* leave invalid input unchanged */
  }
}

function syncModelIdPresetSelect() {
  let formatted;
  try {
    formatted = formatPacket(parseHexBytes(modelIdInput.value, "Model ID", HEX_ADDR_ID_OPTS));
  } catch {
    modelIdPresetSelect.value = "";
    return;
  }

  const matched = Array.from(modelIdPresetSelect.options).find(
    (opt) => opt.value !== "" && opt.value === formatted,
  );
  modelIdPresetSelect.value = matched ? matched.value : "";
}

modelIdPresetSelect.addEventListener("change", (event) => {
  const hex = event.target.value;
  if (!hex) {
    return;
  }

  modelIdInput.value = hex;
});

const syncDualNumericInputs = [
  setupByteDecimalPair({
    hexId: "start-address",
    decimalId: "start-address-decimal",
    label: "Start Address",
    parseOptions: HEX_ADDR_ID_OPTS,
    getByteLength: () => getCurrentAddressLength(4),
  }),
  setupRequestCountDecimalPair(),
  setupByteDecimalPair({
    hexId: "address-step",
    decimalId: "address-step-decimal",
    label: "Change Address By",
    parseOptions: HEX_ADDR_ID_OPTS,
    getByteLength: () => getCurrentAddressLength(4),
  }),
  setupByteDecimalPair({
    hexId: "request-size",
    decimalId: "request-size-decimal",
    label: "Bytes to Request",
    parseOptions: HEX_ADDR_ID_OPTS,
    getByteLength: () => getCurrentAddressLength(4),
  }),
];

function syncDualNumericInputsFromCanonicalValues() {
  syncDualNumericInputs.forEach((sync) => sync());
}

[
  ["device-id", "Device ID", { expectedLength: 1 }],
  ["model-id", "Model ID", HEX_ADDR_ID_OPTS],
  ["start-address", "Start Address", HEX_ADDR_ID_OPTS],
  ["address-step", "Change Address By", HEX_ADDR_ID_OPTS],
  ["request-size", "Bytes to Request", HEX_ADDR_ID_OPTS],
].forEach(([id, label, opts]) => {
  document.querySelector(`#${id}`).addEventListener("blur", (event) => {
    formatHexFieldOnBlur(event.target, label, opts);
  });
});

modelIdInput.addEventListener("blur", () => {
  syncModelIdPresetSelect();
});

document.querySelector("#data-bytes").addEventListener("blur", (event) => {
  const element = event.target;
  const digits = extractHexDigitString(element.value);
  if (!digits) {
    element.value = "";
    return;
  }

  try {
    element.value = formatPacket(parseHexBytes(element.value, "Data to Set", { required: true }));
  } catch {
    /* leave invalid input unchanged */
  }
});

midiInputSelect.addEventListener("change", persistMidiPortSelections);
midiOutputSelect.addEventListener("change", persistMidiPortSelections);
window.addEventListener("pagehide", persistMidiPortSelections);

showRawToggle.addEventListener("click", () => {
  setShowRaw(showRawInput.value !== "1");
});

runButton.addEventListener("click", runSysex);

const copyLinkDefaultLabel = copyLinkButton.textContent;
copyLinkButton.addEventListener("click", async () => {
  errorOutput.textContent = "";
  const url = buildShareUrl();
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.append(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    copyLinkButton.textContent = "Copied link";
    window.setTimeout(() => {
      copyLinkButton.textContent = copyLinkDefaultLabel;
    }, 1500);
  } catch {
    errorOutput.textContent = "Could not copy link to clipboard.";
  }
});

const aboutDialog = document.querySelector("#about-dialog");
document.querySelector("#about-open").addEventListener("click", () => {
  aboutDialog.showModal();
});

viewTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    setActiveView(tab.dataset.view);
  });
});

applyShareParamsFromUrl();
setActiveView("sysex");
syncDualNumericInputsFromCanonicalValues();
updateMessageFields();
syncModelIdPresetSelect();
ensureMidiAccess().catch((error) => {
  midiStatus.textContent = error.message;
});
