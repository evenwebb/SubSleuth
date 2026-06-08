    const WATCH_HISTORY_FILENAMES = new Set(["watch-history.json", "watch-history.html"]);
    const SUBSCRIPTION_FILENAMES = new Set(["subscriptions.csv", "subscriptions.json"]);
    const CHANNEL_ID_PATTERN = /\/channel\/([A-Za-z0-9_-]+)/i;
    const HANDLE_PATTERN = /\/@([A-Za-z0-9._-]+)/i;
    const USER_PATTERN = /\/user\/([A-Za-z0-9._-]+)/i;
    const CUSTOM_PATTERN = /\/c\/([A-Za-z0-9._-]+)/i;

    const STORAGE_SETTINGS = "subsleuth-settings";
    const STORAGE_SESSION = "subsleuth-session";
    const STORAGE_HIDDEN = "subsleuth-hidden";
    const IDB_NAME = "subsleuth-cache";
    const IDB_STORE = "raw";
    const IDB_KEY = "import";
    const LARGE_EXPORT_BYTES = 8 * 1024 * 1024;
    const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
    const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
    const DEMO_UPLOAD_LABEL = "demo-data";
    const TIMEZONE_OFFSETS = {
      UTC: "+0000", GMT: "+0000", BST: "+0100",
      EDT: "-0400", EST: "-0500", PDT: "-0700", PST: "-0800",
      CDT: "-0500", CST: "-0600", CET: "+0100", CEST: "+0200"
    };
    const PARSE_YIELD_EVERY = 2500;
    const IDB_ANALYSIS_KEY = "analysis";
    const SESSION_ANALYSIS_LOCAL_MAX = 450 * 1024;
    const CACHE_SCHEMA_VERSION = 1;
    const SCORE_WATCH_WEIGHT = 3.5;
    const SCORE_UNIQUE_CAP = 25;
    const SCORE_UNIQUE_WEIGHT = 1.75;
    const SCORE_RECENCY_MAX = 36;
    const SCORE_RECENCY_DIVISOR = 10;
    const SCORE_SPAN_DIVISOR = 30;
    const SCORE_SPAN_MAX = 18;

    const state = {
      uploadedFiles: [],
      uploadedFileNames: [],
      rawFiles: { watchFiles: [], subscriptionFiles: [] },
      analysis: null,
      csvUrl: "#",
      currentStep: "welcome",
      maxStepIndex: 0,
      showHidden: false,
      fileDiagnostics: null,
      importSizeBytes: 0,
      cacheWarning: null,
      isDemo: false,
      tableSort: {},
      parsedWatch: null,
      analysisRunId: 0,
      pendingResultsRender: 0,
      isRunBusy: false,
      ignoredWatchFiles: [],
      hiddenChannels: null,
      csvDownloadTimer: 0
    };

    let idbPromise = null;

    const panels = {
      welcome: document.getElementById("panelWelcome"),
      export: document.getElementById("panelExport"),
      upload: document.getElementById("panelUpload"),
      tune: document.getElementById("panelTune"),
      results: document.getElementById("panelResults")
    };

    const progress = {
      welcome: document.getElementById("progressWelcome"),
      export: document.getElementById("progressExport"),
      upload: document.getElementById("progressUpload"),
      tune: document.getElementById("progressTune"),
      results: document.getElementById("progressResults")
    };

    const wizardTitle = document.getElementById("wizardTitle");
    const wizardIntro = document.getElementById("wizardIntro");
    const stepStatus = document.getElementById("stepStatus");
    const presetDescription = document.getElementById("presetDescription");
    const resultsShell = document.getElementById("resultsShell");

    const fileInput = document.getElementById("fileInput");
    const folderInput = document.getElementById("folderInput");
    const browseFolderButton = document.getElementById("browseFolderButton");
    const dropzone = document.getElementById("dropzone");
    const statusEl = document.getElementById("status");
    const uploadDiagnosticsEl = document.getElementById("uploadDiagnostics");
    const uploadFileListEl = document.getElementById("uploadFileList");
    const minVideosInput = document.getElementById("minVideosInput");
    const limitInput = document.getElementById("limitInput");
    const recentWindowSelect = document.getElementById("recentWindowSelect");
    const staleMonthsSelect = document.getElementById("staleMonthsSelect");
    const inactiveMonthsSelect = document.getElementById("inactiveMonthsSelect");
    const localOnlyAvatarsInput = document.getElementById("localOnlyAvatarsInput");
    const statsGrid = document.getElementById("statsGrid");
    const highlightGrid = document.getElementById("highlightGrid");
    const downloadCsvButton = document.getElementById("downloadCsvButton");
    const downloadHtmlButton = document.getElementById("downloadHtmlButton");
    const showHiddenButton = document.getElementById("showHiddenButton");
    const runAnalysisButton = document.getElementById("runAnalysisButton");
    const parseProgressEl = document.getElementById("parseProgress");
    const parseProgressBarEl = document.getElementById("parseProgressBar");
    const cacheWarningEl = document.getElementById("cacheWarning");
    const resultsCacheWarningEl = document.getElementById("resultsCacheWarning");
    const demoCtaEl = document.getElementById("demoCta");
    const demoCtaButton = document.getElementById("demoCtaButton");
    const presetInputs = [...document.querySelectorAll('input[name="preset"]')];
    const resultsHeadline = document.getElementById("resultsHeadline");
    const resultsNarrative = document.getElementById("resultsNarrative");
    const inactiveSubsLead = document.getElementById("inactiveSubsLead");
    const unsubscribedTable = document.getElementById("unsubscribedTable");
    const recentTable = document.getElementById("recentTable");
    const inactiveTable = document.getElementById("inactiveTable");
    const overallTable = document.getElementById("overallTable");
    const unsubscribedTag = document.getElementById("unsubscribedTag");
    const recentTag = document.getElementById("recentTag");
    const inactiveTag = document.getElementById("inactiveTag");
    const overallTag = document.getElementById("overallTag");

    const mobileLayoutMql = window.matchMedia("(max-width: 760px)");
    let useCardLayout = mobileLayoutMql.matches;
    mobileLayoutMql.addEventListener("change", (event) => {
      if (event.matches === useCardLayout) return;
      useCardLayout = event.matches;
      if (state.analysis && state.currentStep === "results") scheduleResultsRender();
    });

    const STEP_ORDER = ["welcome", "export", "upload", "tune", "results"];

    const STEP_META = {
      welcome: ["Step 1 of 5", "Welcome", "Your YouTube export stays in this browser tab."],
      export: ["Step 2 of 5", "Export from Google", "Download your YouTube data from Google Takeout."],
      upload: ["Step 3 of 5", "Upload", "Add your Takeout zip or the raw files."],
      tune: ["Step 4 of 5", "Settings", "Pick a preset and run the check."],
      results: ["Step 5 of 5", "Results", "Channels you watch but aren't subscribed to."]
    };

    document.getElementById("startWizardButton").addEventListener("click", () => setWizardStep("export"));
    document.getElementById("backToWelcomeButton").addEventListener("click", () => setWizardStep("welcome"));
    document.getElementById("toUploadButton").addEventListener("click", () => setWizardStep("upload"));
    document.getElementById("backToExportButton").addEventListener("click", () => setWizardStep("export"));
    document.getElementById("toSettingsButton").addEventListener("click", () => {
      if (!hasCachedImport() && !state.analysis) {
        setStatus("Add a file first.");
        return;
      }
      setWizardStep("tune");
    });
    document.getElementById("backToUploadButton").addEventListener("click", () => setWizardStep("upload"));
    document.getElementById("backToSettingsButton").addEventListener("click", () => setWizardStep("tune"));
    document.getElementById("startFreshButton").addEventListener("click", () => startFresh());
    const clearAllDataButton = document.getElementById("clearAllDataButton");
    if (clearAllDataButton) {
      clearAllDataButton.addEventListener("click", () => clearAllDataFromSettings());
    }
    document.getElementById("runAnalysisButton").addEventListener("click", () => analyzeCurrentUpload());
    document.getElementById("demoButton").addEventListener("click", () => { loadDemoData(); });
    if (demoCtaButton) {
      demoCtaButton.addEventListener("click", () => setWizardStep("upload"));
    }

    fileInput.addEventListener("change", async () => {
      await applyUploadedFiles(Array.from(fileInput.files || []), "selected");
    });

    if (folderInput) {
      folderInput.addEventListener("change", async () => {
        await applyUploadedFiles(Array.from(folderInput.files || []), "selected");
        folderInput.value = "";
      });
    }

    if (browseFolderButton && folderInput) {
      browseFolderButton.addEventListener("click", () => folderInput.click());
    }

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("dragover");
    });

    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("dragover");
    });

    dropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("dragover");
      const files = await filesFromDataTransfer(event.dataTransfer);
      await applyUploadedFiles(files, "dropped");
    });

    presetInputs.forEach((input) => {
      input.addEventListener("change", () => {
        applyPreset(input.value);
        saveSettings();
        refreshInactiveSubscriptions();
        if (state.analysis) scheduleResultsRender();
        updateRunButtonLabel();
      });
    });

    minVideosInput.addEventListener("input", () => onSettingsChanged());
    [limitInput, recentWindowSelect, staleMonthsSelect].forEach((element) => {
      if (element) element.addEventListener("input", () => onSettingsChanged());
    });
    if (inactiveMonthsSelect) {
      inactiveMonthsSelect.addEventListener("input", () => {
        saveSettings();
        refreshInactiveSubscriptions();
        updateInactiveSubsLead();
        if (state.analysis) scheduleResultsRender();
      });
    }
    if (localOnlyAvatarsInput) {
      localOnlyAvatarsInput.addEventListener("change", () => onSettingsChanged());
    }

    downloadHtmlButton.addEventListener("click", () => downloadHtmlReport());
    showHiddenButton.addEventListener("click", () => {
      state.showHidden = !state.showHidden;
      updateShowHiddenButton();
      if (state.analysis) rerenderResults();
    });

    STEP_ORDER.forEach((stepKey) => {
      const item = progress[stepKey];
      item.addEventListener("click", () => navigateToStep(stepKey));
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          navigateToStep(stepKey);
        }
      });
    });

    initApp();

    function ensureJsZipReady() {
      if (typeof JSZip === "undefined") {
        setStatus("Still loading file support. Wait a moment and try again.");
        return false;
      }
      return true;
    }

    function setRunBusy(busy) {
      state.isRunBusy = busy;
      if (runAnalysisButton) {
        runAnalysisButton.disabled = busy;
        runAnalysisButton.setAttribute("aria-busy", busy ? "true" : "false");
      }
    }

    function getInactiveRecentMonths() {
      return Math.max(1, Number(inactiveMonthsSelect?.value) || 6);
    }

    async function initApp() {
      if (typeof JSZip === "undefined") {
        window.addEventListener("load", () => initApp(), { once: true });
        return;
      }
      loadSettings();
      await restoreSession();
      updateInactiveSubsLead();
      updateShowHiddenButton();
      updateRunButtonLabel();
      renderCacheWarnings();
      renderDemoCta();
      renderUploadFileList();
      if (window.location.protocol === "file:") {
        setStatus("Opened from disk. For folder upload and caching, serve subsleuth-pages over http:// (see README).");
      }
      if (!state.analysis) {
        setWizardStep(state.currentStep || "welcome");
        renderEmptyResults();
      }
    }

    function subtractCalendarMonths(date, months) {
      if (months <= 0) return new Date(date.getTime());
      const year = date.getUTCFullYear();
      let month = date.getUTCMonth() - months;
      let adjustedYear = year;
      while (month < 0) {
        month += 12;
        adjustedYear -= 1;
      }
      const maxDay = new Date(Date.UTC(adjustedYear, month + 1, 0)).getUTCDate();
      const day = Math.min(date.getUTCDate(), maxDay);
      return new Date(Date.UTC(adjustedYear, month, day, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
    }

    function analysisReferenceDate() {
      if (state.analysis?.analyzedAt) return new Date(state.analysis.analyzedAt);
      return new Date();
    }

    function refreshInactiveSubscriptions() {
      if (!state.analysis?.overallChannels?.length) return;
      const subscriptionChannels = state.analysis.subscriptionChannels?.length
        ? state.analysis.subscriptionChannels
        : parseSubscriptionFiles(state.rawFiles.subscriptionFiles || []).channels;
      const watchIndex = buildWatchIndex(new Map(
        state.analysis.overallChannels.map((channel) => [channel.channelKey, channel])
      ));
      state.analysis.inactiveSubscriptions = findInactiveSubscriptions(
        watchIndex,
        subscriptionChannels,
        getInactiveRecentMonths(),
        analysisReferenceDate()
      );
      void saveSession();
    }

    function setWizardStep(step) {
      state.currentStep = step;
      const currentIndex = STEP_ORDER.indexOf(step);
      state.maxStepIndex = Math.max(state.maxStepIndex, currentIndex);

      Object.entries(panels).forEach(([key, panel]) => {
        const active = key === step;
        panel.classList.toggle("is-visible", active);
        if (active) {
          panel.removeAttribute("hidden");
          panel.removeAttribute("inert");
        } else {
          panel.setAttribute("hidden", "");
          panel.setAttribute("inert", "");
        }
      });

      STEP_ORDER.forEach((key, index) => {
        const item = progress[key];
        item.classList.remove("is-active", "is-done", "is-clickable");
        item.removeAttribute("aria-current");
        if (index < currentIndex) {
          item.classList.add("is-done", "is-clickable");
        }
        if (index === currentIndex) {
          item.classList.add("is-active");
          item.setAttribute("aria-current", "step");
        }
      });

      const meta = STEP_META[step];
      wizardTitle.textContent = meta[1];
      wizardIntro.textContent = meta[2];
      stepStatus.textContent = "";
      stepStatus.append(`${meta[0]} `);
      const stepLabel = document.createElement("span");
      stepLabel.textContent = `· ${meta[1]}`;
      stepStatus.append(stepLabel);
      if (step === "upload") syncUploadPanel();
      if (step === "tune") updateRunButtonLabel();
      if (step === "results" && state.analysis) scheduleResultsRender();
      renderDemoCta();
      saveSession();
    }

    function isDemoSession() {
      return Boolean(state.isDemo);
    }

    function renderDemoCta() {
      if (!demoCtaEl) return;
      const show = isDemoSession() && state.currentStep !== "welcome";
      demoCtaEl.hidden = !show;
    }

    function onSettingsChanged() {
      saveSettings();
      if (state.analysis) scheduleResultsRender();
      updateRunButtonLabel();
      updateInactiveSubsLead();
    }

    function updateRunButtonLabel() {
      if (!runAnalysisButton) return;
      runAnalysisButton.textContent = (state.analysis || hasCachedImport()) ? "Re-run with new rules" : "Run";
    }

    function hasCachedImport() {
      return Boolean(
        state.uploadedFiles.length ||
        state.rawFiles.watchFiles.length ||
        state.rawFiles.subscriptionFiles.length
      );
    }

    function syncUploadPanel() {
      if (state.uploadedFileNames.length) {
        if (state.uploadedFiles.length) {
          setStatus(summarizeFiles(state.uploadedFiles, "loaded"));
        } else {
          setStatus(`Files ready: ${state.uploadedFileNames.join(", ")}\nNo need to re-upload unless you want to replace them.`);
        }
      }
      if (state.fileDiagnostics) renderUploadDiagnostics(state.fileDiagnostics);
      renderUploadFileList();
    }

    function getFileRelativePath(file) {
      return file.webkitRelativePath || file.name;
    }

    function getFileBasename(file) {
      return getFileRelativePath(file).split("/").pop().toLowerCase();
    }

    function isTakeoutDataFile(file) {
      const base = getFileBasename(file);
      return WATCH_HISTORY_FILENAMES.has(base) || SUBSCRIPTION_FILENAMES.has(base);
    }

    async function readAllDirectoryEntries(reader) {
      const entries = [];
      let batch = [];
      do {
        batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
        entries.push(...batch);
      } while (batch.length > 0);
      return entries;
    }

    async function traverseFileTree(entry, prefix, files) {
      if (entry.isFile) {
        const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
        const relativePath = `${prefix}${entry.name}`;
        try {
          Object.defineProperty(file, "webkitRelativePath", { value: relativePath, configurable: true });
        } catch {
          /* ignore */
        }
        if (isTakeoutDataFile(file) || getFileBasename(file).endsWith(".zip")) {
          files.push(file);
        }
      } else if (entry.isDirectory) {
        const reader = entry.createReader();
        const children = await readAllDirectoryEntries(reader);
        for (const child of children) {
          await traverseFileTree(child, `${prefix}${entry.name}/`, files);
        }
      }
    }

    async function filesFromDataTransfer(dataTransfer) {
      const items = dataTransfer.items ? [...dataTransfer.items] : [];
      const entries = items
        .map((item) => (typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
        .filter(Boolean);

      if (entries.length) {
        const files = [];
        for (const entry of entries) {
          await traverseFileTree(entry, "", files);
        }
        if (files.length) return files;
      }

      return Array.from(dataTransfer.files || []);
    }

    function normalizeUploadedFiles(files) {
      const zipFiles = files.filter((file) => getFileBasename(file).endsWith(".zip"));
      if (zipFiles.length) return zipFiles;
      const takeoutFiles = files.filter(isTakeoutDataFile);
      if (takeoutFiles.length) return takeoutFiles;
      return files;
    }

    function isUnsupportedArchive(file) {
      return /\.(tar|tgz|gz|rar|7z)$/i.test(getFileBasename(file));
    }

    async function applyUploadedFiles(files, verb) {
      const unsupported = files.filter(isUnsupportedArchive);
      if (unsupported.length) {
        setStatus("That archive format is not supported in the browser. Use a Takeout .zip or an extracted folder.");
        return;
      }
      const normalized = normalizeUploadedFiles(files);
      state.uploadedFiles = normalized;
      state.uploadedFileNames = normalized.map((file) => getFileRelativePath(file));
      setFileInputFiles(normalized);
      if (normalized.length) {
        await updateUploadStatus(verb);
      } else {
        setStatus("No Takeout files found. Upload the .zip, choose the Takeout folder, or include watch-history and subscriptions.");
        await clearImportState({ keepStep: true });
      }
    }

    function getUploadDisplayFiles() {
      const seen = new Set();
      const items = [];
      for (const file of state.uploadedFiles) {
        const name = getFileRelativePath(file);
        if (seen.has(name)) continue;
        seen.add(name);
        items.push({ name, size: file.size || 0 });
      }
      for (const name of state.uploadedFileNames) {
        if (seen.has(name)) continue;
        seen.add(name);
        items.push({ name, size: null });
      }
      return items;
    }

    function setFileInputFiles(files) {
      const transfer = new DataTransfer();
      for (const file of files) {
        if (file instanceof File) transfer.items.add(file);
      }
      fileInput.files = transfer.files;
    }

    function renderUploadFileList() {
      if (!uploadFileListEl) return;
      const files = getUploadDisplayFiles();
      if (!files.length) {
        uploadFileListEl.hidden = true;
        uploadFileListEl.innerHTML = "";
        return;
      }
      uploadFileListEl.hidden = false;
      uploadFileListEl.innerHTML = files.map((file) => `
        <div class="upload-file-item">
          <div class="upload-file-meta">
            <strong>${escapeHtml(file.name)}</strong>
            <span>${file.size ? formatBytes(file.size) : "Cached from last visit"}</span>
          </div>
          <button type="button" class="btn-remove-file" data-remove-file="${escapeHtml(file.name)}">Remove</button>
        </div>
      `).join("");
      uploadFileListEl.querySelectorAll("[data-remove-file]").forEach((button) => {
        button.addEventListener("click", () => removeUploadedFile(button.dataset.removeFile));
      });
    }

    async function idbClearRaw() {
      try {
        const db = await openIdb();
        await new Promise((resolve, reject) => {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).delete(IDB_KEY);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        });
      } catch {
        /* ignore */
      }
    }

    async function clearAllLocalData() {
      localStorage.removeItem(STORAGE_SESSION);
      localStorage.removeItem(STORAGE_SETTINGS);
      localStorage.removeItem(STORAGE_HIDDEN);
      try {
        await idbDeleteValue(IDB_KEY);
        await idbDeleteValue(IDB_ANALYSIS_KEY);
      } catch {
        /* ignore */
      }
    }

    async function clearAllDataFromSettings() {
      const ok = window.confirm(
        "Clear all local SubSleuth data? This removes cached imports, results, settings, and hidden channels from this browser."
      );
      if (!ok) return;
      await clearAllLocalData();
      state.maxStepIndex = 0;
      state.tableSort = {};
      state.showHidden = false;
      state.uploadedFileNames = [];
      state.uploadedFiles = [];
      state.rawFiles = { watchFiles: [], subscriptionFiles: [] };
      state.analysis = null;
      state.isDemo = false;
      state.fileDiagnostics = null;
      state.importSizeBytes = 0;
      state.cacheWarning = null;
      state.parsedWatch = null;
      applyPreset("balanced");
      saveSettings();
      setFileInputFiles([]);
      clearUploadDiagnostics();
      renderUploadFileList();
      renderEmptyResults();
      renderCacheWarnings();
      renderDemoCta();
      updateRunButtonLabel();
      updateShowHiddenButton();
      setStatus("All local data cleared.");
      setWizardStep("welcome");
    }

    async function startFresh() {
      const ok = window.confirm("Start fresh? Your upload, results, and cached import will be cleared.");
      if (!ok) return;
      state.maxStepIndex = 0;
      state.tableSort = {};
      state.showHidden = false;
      await clearImportState({ keepStep: true, goToWelcome: true });
      updateShowHiddenButton();
    }

    async function clearImportState(options = {}) {
      const { keepStep = false, goToWelcome = false } = options;
      state.uploadedFiles = [];
      state.uploadedFileNames = [];
      state.rawFiles = { watchFiles: [], subscriptionFiles: [] };
      state.analysis = null;
      state.isDemo = false;
      state.fileDiagnostics = null;
      state.importSizeBytes = 0;
      state.cacheWarning = null;
      state.parsedWatch = null;
      setFileInputFiles([]);
      clearUploadDiagnostics();
      renderUploadFileList();
      setStatus("No file selected yet.");
      renderEmptyResults();
      await idbClearRaw();
      await saveSession();
      renderCacheWarnings();
      renderDemoCta();
      updateRunButtonLabel();
      if (goToWelcome) {
        state.maxStepIndex = 0;
        setWizardStep("welcome");
      } else if (!keepStep && (state.currentStep === "results" || state.currentStep === "tune")) {
        setWizardStep("upload");
      }
    }

    async function removeUploadedFile(fileName) {
      state.uploadedFiles = state.uploadedFiles.filter((file) => getFileRelativePath(file) !== fileName);
      state.uploadedFileNames = state.uploadedFileNames.filter((name) => name !== fileName);
      setFileInputFiles(state.uploadedFiles);
      state.analysis = null;
      state.isDemo = false;

      if (!state.uploadedFileNames.length) {
        await clearImportState();
        return;
      }

      if (state.uploadedFiles.length) {
        await updateUploadStatus("updated");
        return;
      }

      state.rawFiles = { watchFiles: [], subscriptionFiles: [] };
      state.fileDiagnostics = null;
      state.importSizeBytes = 0;
      clearUploadDiagnostics();
      await idbClearRaw();
      setStatus("Removed cached import. Upload again to continue.");
      renderUploadFileList();
      renderEmptyResults();
      await saveSession();
      renderCacheWarnings();
      renderDemoCta();
      updateRunButtonLabel();
      if (state.currentStep === "results" || state.currentStep === "tune") setWizardStep("upload");
    }

    function navigateToStep(step) {
      const targetIndex = STEP_ORDER.indexOf(step);
      if (targetIndex > state.maxStepIndex) {
        setStatus("Complete the earlier steps first.");
        return;
      }
      if (step === "tune" && !hasCachedImport() && !state.analysis) {
        setStatus("Add a file first.");
        return;
      }
      if (step === "results" && !state.analysis) {
        setStatus("Run the check first to see results.");
        return;
      }
      setWizardStep(step);
    }

    function applyPreset(preset) {
      const presets = {
        focused: {
          minVideos: 3,
          limit: 12,
          months: 6,
          staleMonths: 12,
          inactiveMonths: 6,
          description: "Focused: stricter cut-off, shorter list."
        },
        balanced: {
          minVideos: 3,
          limit: 18,
          months: 6,
          staleMonths: 0,
          inactiveMonths: 6,
          description: "Balanced: good default for most exports."
        },
        explore: {
          minVideos: 2,
          limit: 24,
          months: 12,
          staleMonths: 0,
          inactiveMonths: 6,
          description: "Explore: more channels, including weaker matches."
        }
      }[preset] || {
        minVideos: 3,
        limit: 18,
        months: 6,
        staleMonths: 0,
        inactiveMonths: 6,
        description: "Balanced: good default for most exports."
      };

      minVideosInput.value = presets.minVideos;
      limitInput.value = presets.limit;
      recentWindowSelect.value = String(presets.months);
      if (staleMonthsSelect) staleMonthsSelect.value = String(presets.staleMonths);
      if (inactiveMonthsSelect && presets.inactiveMonths != null) {
        inactiveMonthsSelect.value = String(presets.inactiveMonths);
      }
      presetDescription.textContent = presets.description;
      const presetInput = presetInputs.find((input) => input.value === preset);
      if (presetInput) presetInput.checked = true;

    }

    async function analyzeCurrentUpload() {
      if (state.isRunBusy) return;
      if (!ensureJsZipReady()) return;
      let rawFiles = state.rawFiles;

      if (state.uploadedFiles.length) {
        state.uploadedFileNames = state.uploadedFiles.map((file) => getFileRelativePath(file));
        state.importSizeBytes = state.uploadedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
        if (state.importSizeBytes > MAX_UPLOAD_BYTES) {
          setStatus(`Upload is too large (${formatBytes(state.importSizeBytes)}). Try the .zip only, or use the CLI.`);
          return;
        }
        invalidateParsedWatch();
        rawFiles = await collectInputFiles(state.uploadedFiles, setParseProgress);
        state.rawFiles = rawFiles;
      } else if (!rawFiles.watchFiles.length && !rawFiles.subscriptionFiles.length) {
        setStatus("Add a file first.");
        setWizardStep("upload");
        return;
      } else {
        setStatus("Re-running with your saved import…");
      }

      state.fileDiagnostics = buildFileDiagnostics(rawFiles);
      if (!rawFiles.subscriptionFiles.length) {
        const proceed = window.confirm(
          "No subscriptions file was found. Every watched channel will look unsubscribed. Continue anyway?"
        );
        if (!proceed) return;
      }
      setRunBusy(true);
      setStatus("Analyzing watch history…");
      try {
        const analysis = await analyzeFilesAsync(rawFiles);
        if (!analysis) return;
        state.analysis = analysis;
        state.fileDiagnostics = analysis.diagnostics || state.fileDiagnostics;
        renderUploadDiagnostics(state.fileDiagnostics);
        setWizardStep("results");
        setStatus(formatAnalysisStatus(rawFiles, state.analysis));
        setParseProgress(null);
        await saveSession();
        renderCacheWarnings();
        updateRunButtonLabel();
      } catch (error) {
        setParseProgress(null);
        setStatus(error?.message || "Analysis failed. Check your Takeout files and try again.");
      } finally {
        setRunBusy(false);
      }
    }

    const DEMO_CHANNELS = {
      veritasium: {
        name: "Veritasium",
        id: "UCin0m13qWv3-051xlWlHamA",
        handle: "veritasium",
        avatar: "https://yt3.googleusercontent.com/rVBD4hhq0_7eRPwkOkyCreFtoY2Sbx7wowBB02okCSkJoQ5LDlUv9x6uZKmqyIeIaGQNg93u=s88-c-k-c0x00ffffff-no-rj"
      },
      wendover: {
        name: "Wendover Productions",
        id: "UCTWKe1zATFV6d0o6oLS9sgw",
        handle: "wendoverproductions",
        avatar: "https://yt3.googleusercontent.com/OnFIYArpFofrmngLXAsDGHsoVUpPA-yW3oD2ug7J2tq7H4BUcnnQvyfaQ8vw6s5JCiXJu1hb5A=s88-c-k-c0x00ffffff-no-rj"
      },
      techConn: {
        name: "Technology Connections",
        id: "UCy0tKL1T7wFoYcxCe0xjN6Q",
        handle: "TechnologyConnections",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_lG8iUz4mpHBrzJSDYEKT0qe2XmhZUUUzhzcJbz9cE3rQ=s88-c-k-c0x00ffffff-no-rj"
      },
      cgpGrey: {
        name: "CGP Grey",
        id: "UCS_RD1EVAuBxvd1ytDHXG0g",
        handle: "cgpgrey",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_nxrDGcxMGo8yKf2_Dw0eaGEWj39IAIdZQjAuz-_mBHjUI=s88-c-k-c0x00ffffff-no-rj"
      },
      babish: {
        name: "Binging with Babish",
        id: "UC4avs5jYd_FvzQ8f0XYziqw",
        handle: "bingingwithbabish",
        avatar: "https://yt3.googleusercontent.com/AlCRk3X8JvmNqHC7R3c7yVDQaGyUvMAd3GXY77vTgzGS1Qa_vlVFY0ZNSH56otpeBKDq3gF-yw=s88-c-k-c0x00ffffff-no-rj"
      },
      vsauce: {
        name: "Vsauce",
        id: "UC6nSFpj9HTCZ5t-N3Hmf3GQ",
        handle: "Vsauce",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_mpYedipdXUXCKkwjQEeFrepFlDHZ0LiczqWeKyG0YmJvA=s88-c-k-c0x00ffffff-no-rj"
      },
      hai: {
        name: "Half as Interesting",
        id: "UC9RM-iSvTu1uPJb8X5yp3EQ",
        handle: "HalfasInteresting",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_lrhEmfrgwQlzJM4UwITdeCak68LTWLaJ6_2bbofLCFb3s=s88-c-k-c0x00ffffff-no-rj"
      },
      tomScott: {
        name: "Tom Scott",
        id: "UCHqDTfIX-0DGaHlWvv6JZCw",
        handle: "TomScottGo",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_lJKZj4ba9aw0qRbKwXMkHkZmq_eC_dtwPMOGFBYdCSIkEk=s88-c-k-c0x00ffffff-no-rj"
      },
      geographyNow: {
        name: "Geography Now",
        id: "UCPUoqF69Uflr_XQnIAM8y-Q",
        handle: "GeographyNow",
        avatar: "https://yt3.googleusercontent.com/F6rTK52cIGQiLsyPpCETZfLIVxrQNA2QAOnGNAPWjVU-n5B3LXGnJ2GDxEfl64f0FjGWTX5KSDY=s88-c-k-c0x00ffffff-no-rj"
      },
      smarterEveryDay: {
        name: "SmarterEveryDay",
        id: "UC8VkNBOwvsTlFjoSnNSMmxw",
        handle: "smartereveryday",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_l59Ewmp0DHZBRWbY9dVqjd2_mWwvrn8ad0bJfmdbMRYcA=s88-c-k-c0x00ffffff-no-rj"
      },
      jaiden: {
        name: "Jaiden Animations",
        id: "UCN-qGJtXJCiG0mMXR2fga6A",
        handle: "JaidenAnimations",
        avatar: "https://yt3.googleusercontent.com/1vzRI839ZZEBuF5XhAQwV3PBv9iVghlVlv8vFIcgk6wA_tbH01hArxNKF4tl5ztNd9w058zk=s88-c-k-c0x00ffffff-no-rj"
      },
      kurzgesagt: {
        name: "Kurzgesagt – In a Nutshell",
        id: "UCq8ZAAsI89IoJ-fn1gYpO3g",
        handle: "kurzgesagt",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_n1Ribd7LwdP_qKtqWL3ZDfIgv9M1d6g78VwpHGXVR2Ir4=s88-c-k-c0x00ffffff-no-rj"
      },
      bonAppetit: {
        name: "Bon Appétit",
        id: "UCbpMy0Fg74NjyJAR8niSlLA",
        handle: "bonappetit",
        avatar: "https://yt3.googleusercontent.com/cXS_yturdFtxAvqzJRnbMtZRYKCv3CDD7VHqHmhGZ2jgM8PYnOAbAbhZaK-Wb1NWgIrxrUjJiA=s88-c-k-c0x00ffffff-no-rj"
      },
      primitiveTech: {
        name: "Primitive Technology",
        id: "UCAL3JXZ_SSmMDtqVy6RAi5Q",
        handle: "PrimitiveTechnology",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_nla250mnTrIEKkDktH6n6lyoCetN2IQEKL4N_tjLwQrg=s88-c-k-c0x00ffffff-no-rj"
      },
      threeBlue: {
        name: "3Blue1Brown",
        id: "UCYO_jab_esuFRV4b17AJtAw",
        handle: "3blue1brown",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_nFzZFPLxPZRHcE3SSwzdrbuWqfoWYwLAu0_2iO6blQYAU=s88-c-k-c0x00ffffff-no-rj"
      },
      mkbhd: {
        name: "Marques Brownlee",
        id: "UCBJycsmduvYEL83R_U4JriQ",
        handle: "mkbhd",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_nPWlG1-rYkTqPofHGd0uvMt1_buTrVNnkaG8gznFQZRtQ=s88-c-k-c0x00ffffff-no-rj"
      },
      tedEd: {
        name: "TED-Ed",
        id: "UCsooa4yRKGN_zEE8iknghZA",
        handle: "TEDEd",
        avatar: "https://yt3.googleusercontent.com/ytc/AIdro_nj_LoIf6jMHTM1ea91bMglIS_Y3P7000MhTC3w6fgFdi4=s88-c-k-c0x00ffffff-no-rj"
      }
    };

    const DEMO_AVATAR_BY_ID = Object.fromEntries(
      Object.values(DEMO_CHANNELS).flatMap((channel) => [[channel.id, channel.avatar]])
    );

    const DEMO_AVATAR_BY_NAME = Object.fromEntries(
      Object.values(DEMO_CHANNELS).map((channel) => [channel.name.trim().toLowerCase(), channel.avatar])
    );

    const DEMO_HANDLE_BY_NAME = Object.fromEntries(
      Object.values(DEMO_CHANNELS).map((channel) => [channel.name.trim().toLowerCase(), channel.handle])
    );

    function demoChannelUrl(channelId) {
      return `https://www.youtube.com/channel/${channelId}`;
    }

    function demoChannel(key) {
      return DEMO_CHANNELS[key];
    }

    function daysAgoIso(daysAgo, slot = 0) {
      const date = new Date();
      date.setUTCDate(date.getUTCDate() - daysAgo);
      date.setUTCHours(8 + (slot % 14), (slot * 17) % 60, 0, 0);
      return date.toISOString();
    }

    function buildDemoWatchEntries() {
      const entries = [];
      let slot = 0;

      const watch = (name, channelId, daysAgo, title) => {
        entries.push(makeWatchEntry(name, demoChannelUrl(channelId), daysAgoIso(daysAgo, slot++), title));
      };

      const series = (name, channelId, titles, startDays, spanDays) => {
        titles.forEach((title, index) => {
          const offset = Math.floor((index / Math.max(titles.length - 1, 1)) * spanDays);
          watch(name, channelId, startDays + offset, title);
        });
      };

      // Real channels, fictional watch history (demo only, not anyone's actual data)
      const CH = Object.fromEntries(
        Object.entries(DEMO_CHANNELS).map(([key, channel]) => [key, channel.id])
      );

      // Likely accidental unsubscribes: heavy, recent, repeat viewing
      series(demoChannel("veritasium").name, CH.veritasium, [
        "[Demo] The hidden physics of elevator cables",
        "[Demo] Why spinning ice skaters speed up",
        "[Demo] Can you measure curiosity?",
        "[Demo] The math behind traffic waves",
        "[Demo] What happens inside a microwave cavity",
        "[Demo] Testing whether hot water freezes faster",
        "[Demo] The surprising strength of spider silk",
        "[Demo] How do barcodes encode numbers?",
        "[Demo] Why do mirrors flip left and right?",
        "[Demo] Building a cloud chamber at home",
        "[Demo] The economics of free samples",
        "[Demo] Do phones really ruin attention spans?",
        "[Demo] What is the speed of dark?",
        "[Demo] Riddle of the infinite hotel lobby"
      ], 2, 45);
      watch(demoChannel("veritasium").name, CH.veritasium, 6, "[Demo] The hidden physics of elevator cables");
      watch(demoChannel("veritasium").name, CH.veritasium, 11, "[Demo] Why spinning ice skaters speed up");
      watch(demoChannel("veritasium").name, CH.veritasium, 18, "[Demo] The math behind traffic waves");
      watch(demoChannel("veritasium").name, CH.veritasium, 24, "[Demo] What happens inside a microwave cavity");

      series(demoChannel("wendover").name, CH.wendover, [
        "[Demo] How overnight shipping actually works",
        "[Demo] The logistics of stadium hot dogs",
        "[Demo] Why airlines overbook on purpose",
        "[Demo] The business model of theme parks",
        "[Demo] How cruise ships stock groceries",
        "[Demo] Why ports charge container fees",
        "[Demo] The anatomy of a grocery supply chain",
        "[Demo] How film festivals pick winners",
        "[Demo] Why casinos are built without clocks",
        "[Demo] The real cost of free two-day delivery",
        "[Demo] How sports leagues schedule seasons",
        "[Demo] Why some cities ban billboards"
      ], 8, 120);

      series(demoChannel("techConn").name, CH.techConn, [
        "[Demo] Why toasters have those slot widths",
        "[Demo] The forgotten history of TV test patterns",
        "[Demo] How traffic lights synchronize",
        "[Demo] Why vinyl records are 33⅓ RPM",
        "[Demo] The engineering of pop-up toasters",
        "[Demo] Why washing machines need HE detergent",
        "[Demo] How dimmer switches actually dim",
        "[Demo] The curious design of electrical plugs",
        "[Demo] Why microwaves have turntables",
        "[Demo] How smoke detectors sniff particles"
      ], 1, 35);
      watch(demoChannel("techConn").name, CH.techConn, 3, "[Demo] Why toasters have those slot widths");
      watch(demoChannel("techConn").name, CH.techConn, 9, "[Demo] How traffic lights synchronize");

      series(demoChannel("cgpGrey").name, CH.cgpGrey, [
        "[Demo] How to become Pope: animated explainer",
        "[Demo] The trouble with tribal names on maps",
        "[Demo] What if the Earth stopped spinning?",
        "[Demo] The difference between the UK and Britain",
        "[Demo] How to read election maps correctly",
        "[Demo] Why hexagons show up in nature",
        "[Demo] The rules of royal succession",
        "[Demo] What counts as a country?"
      ], 20, 90);

      series(demoChannel("babish").name, CH.babish, [
        "[Demo] Recreating the sandwich from that one sitcom",
        "[Demo] Basics with Babish: knife skills drill",
        "[Demo] Movie lasagna, but structurally sound",
        "[Demo] Ramen from a pantry challenge",
        "[Demo] Chocolate lava cake for beginners",
        "[Demo] Reverse-seared steak with herb butter",
        "[Demo] Croissants: first attempt honesty cut"
      ], 55, 140);

      series(demoChannel("vsauce").name, CH.vsauce, [
        "[Demo] What is the scariest number?",
        "[Demo] How much does a shadow weigh?",
        "[Demo] Why do we have eyebrows?",
        "[Demo] What if the moon disappeared tomorrow?",
        "[Demo] How many memories can you store?",
        "[Demo] What is the longest possible game?"
      ], 14, 75);

      series(demoChannel("hai").name, CH.hai, [
        "[Demo] Why this island changes time zones weekly",
        "[Demo] The world's most boring border dispute",
        "[Demo] How a town got named after a typo",
        "[Demo] Why some bridges hum on windy days",
        "[Demo] The airline that only flies on Tuesdays"
      ], 30, 100);

      series(demoChannel("tomScott").name, CH.tomScott, [
        "[Demo] I tried the world's quietest room",
        "[Demo] The railway that crosses itself",
        "[Demo] Why this sign is illegal in one country",
        "[Demo] The park bench with a secret code"
      ], 12, 60);

      series(demoChannel("geographyNow").name, CH.geographyNow, [
        "[Demo] Country profile: fictional demo republic",
        "[Demo] Flag Friday: symbolic colors explained",
        "[Demo] Capital cities you confuse on purpose"
      ], 40, 80);

      // Below default min-videos threshold; should not rank as unsubscribed
      watch(demoChannel("smarterEveryDay").name, CH.smarterEveryDay, 22, "[Demo] Slow motion of a hummingbird feeder");
      watch(demoChannel("smarterEveryDay").name, CH.smarterEveryDay, 48, "[Demo] How archery stabilizers work");
      watch(demoChannel("jaiden").name, CH.jaiden, 70, "[Demo] My awkward grocery store phase");

      // Subscribed channels still appear in overall rankings
      series(demoChannel("kurzgesagt").name, CH.kurzgesagt, [
        "[Demo] The immune system: a friendly overview",
        "[Demo] What if the sun vanished for a week?",
        "[Demo] Black holes explained with birds",
        "[Demo] Loneliness and how cities shape it",
        "[Demo] The asteroid that almost changed everything",
        "[Demo] Antibiotics: a double-edged sword",
        "[Demo] Fusion energy: still worth hoping for?",
        "[Demo] The lifecycle of plastic in the ocean"
      ], 10, 110);

      series(demoChannel("bonAppetit").name, CH.bonAppetit, [
        "[Demo] Test kitchen tries one-pot pasta",
        "[Demo] Claire attempts gourmet crackers",
        "[Demo] Brad ferments something questionable",
        "[Demo] Molly makes weeknight tacos faster",
        "[Demo] Chris recreates a diner milkshake",
        "[Demo] Andy's salad that survives meal prep",
        "[Demo] Rick's butter technique breakdown",
        "[Demo] Carla blind-tests boxed mac and cheese"
      ], 16, 95);

      series(demoChannel("primitiveTech").name, CH.primitiveTech, [
        "[Demo] Tiled hut: no modern tools",
        "[Demo] Charcoal production in the forest",
        "[Demo] Water-powered hammer prototype",
        "[Demo] Forge blower from natural materials",
        "[Demo] Palm fiber rope for shelter frames",
        "[Demo] Clay pottery firing without a kiln"
      ], 25, 130);

      series(demoChannel("threeBlue").name, CH.threeBlue, [
        "[Demo] Eigenvalues: visual intuition",
        "[Demo] Fourier series drawn by hand",
        "[Demo] Gradient descent on a bumpy landscape",
        "[Demo] Bayes theorem with real dice",
        "[Demo] Why π shows up in unexpected places",
        "[Demo] Neural networks as layered functions",
        "[Demo] The determinant as area scaling",
        "[Demo] Markov chains with cute diagrams",
        "[Demo] Complex numbers are rotations",
        "[Demo] SVD: compressing an image demo",
        "[Demo] Eulers formula in one picture",
        "[Demo] Chaos from a simple quadratic map"
      ], 5, 50);
      watch(demoChannel("threeBlue").name, CH.threeBlue, 7, "[Demo] Eigenvalues: visual intuition");
      watch(demoChannel("threeBlue").name, CH.threeBlue, 15, "[Demo] Fourier series drawn by hand");

      series(demoChannel("mkbhd").name, CH.mkbhd, [
        "[Demo] Smartphone camera blind comparison",
        "[Demo] Laptop thermals after a long render",
        "[Demo] EV charging speeds: real world test",
        "[Demo] Studio tour: desk setup refresh",
        "[Demo] Headphones under $200 ranked",
        "[Demo] Foldable phone hinge durability check",
        "[Demo] Smartwatch battery after a travel day",
        "[Demo] Monitor color accuracy for creators",
        "[Demo] Retro tech: MP3 players in 2026",
        "[Demo] Auto-focus tracking on a budget camera",
        "[Demo] Tablet note-taking latency test",
        "[Demo] Wireless earbuds mic quality outdoors",
        "[Demo] Gaming handheld battery marathon",
        "[Demo] Car infotainment UI walkthrough",
        "[Demo] Desk accessory tier list"
      ], 1, 42);

      series(demoChannel("tedEd").name, CH.tedEd, [
        "[Demo] How your brain forms habits",
        "[Demo] The history of zero as a concept",
        "[Demo] Why cities need green corridors",
        "[Demo] The science of sourdough starters"
      ], 35, 85);

      return entries;
    }

    function buildDemoSubscriptionsCsv() {
      const subscribedKeys = ["kurzgesagt", "bonAppetit", "primitiveTech", "threeBlue", "mkbhd", "tedEd"];
      const rows = subscribedKeys.map((key) => {
        const channel = demoChannel(key);
        return `${channel.id},http://www.youtube.com/channel/${channel.id},${channel.name}`;
      });
      return ["Channel ID,Channel URL,Channel title", ...rows].join("\n");
    }

    async function loadDemoData() {
      if (state.isRunBusy) return;
      setRunBusy(true);
      try {
        const watchEntries = buildDemoWatchEntries();
        const subscriptionsCsv = buildDemoSubscriptionsCsv();

        state.isDemo = true;
        state.parsedWatch = null;
        state.rawFiles = {
          watchFiles: [{ name: "watch-history.json", text: JSON.stringify(watchEntries) }],
          subscriptionFiles: [{ name: "subscriptions.csv", text: subscriptionsCsv }]
        };
        state.uploadedFiles = [];
        state.uploadedFileNames = [DEMO_UPLOAD_LABEL];
        state.fileDiagnostics = buildFileDiagnostics(state.rawFiles);
        setStatus("Analyzing demo data…");
        const analysis = await analyzeFilesAsync(state.rawFiles);
        if (!analysis) return;
        state.analysis = analysis;
        setWizardStep("results");
        setStatus(formatAnalysisStatus(state.rawFiles, state.analysis));
        await saveSession();
        renderCacheWarnings();
        updateRunButtonLabel();
        renderDemoCta();
        renderUploadFileList();
      } finally {
        setRunBusy(false);
      }
    }

    function yieldToMain() {
      return new Promise((resolve) => {
        if (typeof requestIdleCallback === "function") {
          requestIdleCallback(() => resolve(), { timeout: 48 });
        } else {
          setTimeout(resolve, 0);
        }
      });
    }

    function scheduleResultsRender() {
      if (state.currentStep !== "results") return;
      if (state.pendingResultsRender) cancelAnimationFrame(state.pendingResultsRender);
      state.pendingResultsRender = requestAnimationFrame(() => {
        state.pendingResultsRender = 0;
        rerenderResults();
      });
    }

    function invalidateParsedWatch() {
      state.parsedWatch = null;
    }

    function watchFilesSignature(files) {
      return files.map((file) => `${file.name}:${(file.text || "").length}`).join("|");
    }

    function selectTakeoutEntries(matches) {
      const watchEntries = [];
      const subscriptionEntries = [];
      let hasWatchJson = false;
      for (const entry of matches) {
        const base = entry.name.split("/").pop().toLowerCase();
        if (base === "watch-history.json") hasWatchJson = true;
      }
      for (const entry of matches) {
        const base = entry.name.split("/").pop().toLowerCase();
        if (base === "watch-history.html" && hasWatchJson) continue;
        if (WATCH_HISTORY_FILENAMES.has(base)) watchEntries.push(entry);
        else if (SUBSCRIPTION_FILENAMES.has(base)) subscriptionEntries.push(entry);
      }
      return [...watchEntries, ...subscriptionEntries];
    }

    async function analyzeFilesAsync(rawFiles) {
      const runId = ++state.analysisRunId;
      const now = new Date();
      const watchedMap = await loadWatchHistoryAsync(rawFiles.watchFiles, now, runId);
      if (runId !== state.analysisRunId) return null;

      const subscriptionData = parseSubscriptionFiles(rawFiles.subscriptionFiles);
      enrichChannelsFromSubscriptions(watchedMap, subscriptionData.channels);
      const watchIndex = buildWatchIndex(watchedMap);
      const overallChannels = sortChannelsOnly([...watchedMap.values()]);
      const unsubscribedChannels = sortChannelsOnly(
        [...watchedMap.values()].filter((channel) => {
          const ref = buildChannelRef(channel.channelName, channel.channelUrl, channel.channelId);
          return !allChannelKeys(ref).some((key) => subscriptionData.keys.has(key));
        })
      );
      const diagnostics = buildFileDiagnostics(rawFiles, state.parseMeta);
      const inactiveSubscriptions = findInactiveSubscriptions(
        watchIndex,
        subscriptionData.channels,
        getInactiveRecentMonths(),
        now
      );
      if (!rawFiles.watchFiles.length) {
        throw new Error("No watch-history.json or watch-history.html found. Check your Takeout export.");
      }

      return {
        overallChannels,
        unsubscribedChannels,
        inactiveSubscriptions,
        subscriptionChannels: subscriptionData.channels,
        watchFileCount: rawFiles.watchFiles.length,
        subscriptionFileCount: rawFiles.subscriptionFiles.length,
        diagnostics,
        analyzedAt: now.toISOString()
      };
    }

    function assertZipEntrySize(entry) {
      const size = entry?._data?.uncompressedSize || 0;
      if (size > MAX_ZIP_ENTRY_BYTES) {
        throw new Error(`Zip entry ${entry.name} is too large (${formatBytes(size)}). Use the CLI instead.`);
      }
    }

    async function collectInputFiles(files, onProgress) {
      const watchFiles = [];
      const subscriptionFiles = [];
      const totalBytes = files.reduce((sum, file) => sum + (file.size || 0), 0);
      let processedBytes = 0;

      const report = (label, fileSize) => {
        processedBytes += fileSize;
        if (!onProgress) return;
        const pct = totalBytes ? Math.min(100, Math.round((processedBytes / totalBytes) * 100)) : 0;
        onProgress(pct, label);
      };

      for (const file of files) {
        const relativePath = getFileRelativePath(file);
        const base = relativePath.split("/").pop().toLowerCase();
        const fileSize = file.size || 0;
        if (base.endsWith(".zip")) {
          if (fileSize > MAX_UPLOAD_BYTES) {
            throw new Error(`Zip file is too large (${formatBytes(fileSize)}). Use the CLI for very large Takeout exports.`);
          }
          report(`Opening ${relativePath} (${formatBytes(fileSize)})…`, 0);
          let zip;
          try {
            zip = fileSize > 48 * 1024 * 1024
              ? await JSZip.loadAsync(await file.arrayBuffer())
              : await JSZip.loadAsync(file);
          } catch (error) {
            throw new Error(`Could not open zip ${relativePath}: ${error?.message || error}`);
          }
          const entries = Object.values(zip.files).filter((entry) => !entry.dir && isZipEntrySafe(entry.name));
          const matches = entries.filter((entry) => {
            const entryBase = entry.name.split("/").pop().toLowerCase();
            return WATCH_HISTORY_FILENAMES.has(entryBase) || SUBSCRIPTION_FILENAMES.has(entryBase);
          });
          const selected = selectTakeoutEntries(matches);
          for (let index = 0; index < selected.length; index += 1) {
            const entry = selected[index];
            assertZipEntrySize(entry);
            const entryBase = entry.name.split("/").pop().toLowerCase();
            report(`Reading ${entryBase} (${index + 1}/${selected.length})…`, Math.round(fileSize / Math.max(selected.length, 1)));
            const text = await entry.async("text");
            if (WATCH_HISTORY_FILENAMES.has(entryBase)) watchFiles.push({ name: entry.name, text });
            if (SUBSCRIPTION_FILENAMES.has(entryBase)) subscriptionFiles.push({ name: entry.name, text });
            if (index % 2 === 1) await yieldToMain();
          }
          if (!selected.length) report(`Searched ${relativePath}: no Takeout files found`, fileSize);
        } else if (WATCH_HISTORY_FILENAMES.has(base) || SUBSCRIPTION_FILENAMES.has(base)) {
          report(`Reading ${relativePath} (${formatBytes(fileSize)})…`, fileSize);
          const text = await file.text();
          if (WATCH_HISTORY_FILENAMES.has(base)) watchFiles.push({ name: relativePath, text });
          if (SUBSCRIPTION_FILENAMES.has(base)) subscriptionFiles.push({ name: relativePath, text });
        }
      }

      if (onProgress) onProgress(100, "Done parsing.");
      const finalized = finalizeCollectedTakeout(watchFiles, subscriptionFiles);
      state.ignoredWatchFiles = finalized.ignoredWatchFiles;
      return finalized;
    }

    function pathRank(name) {
      const lower = name.toLowerCase();
      const youtubePref = lower.includes("youtube") ? 0 : 1;
      const depth = name.split("/").length;
      return [youtubePref, depth, name];
    }

    function comparePathRank(left, right) {
      const a = pathRank(left);
      const b = pathRank(right);
      for (let index = 0; index < 3; index += 1) {
        if (a[index] < b[index]) return -1;
        if (a[index] > b[index]) return 1;
      }
      return 0;
    }

    function pickBestNamedFile(files, basename) {
      const matches = files.filter((file) => file.name.split("/").pop().toLowerCase() === basename);
      if (!matches.length) return null;
      return matches.sort((left, right) => comparePathRank(left.name, right.name))[0];
    }

    function isZipEntrySafe(name) {
      const normalized = name.replace(/\\/g, "/");
      if (normalized.startsWith("/") || /^[a-zA-Z]:\//.test(normalized)) return false;
      const parts = normalized.split("/");
      return !parts.some((part) => part === "..");
    }

    function finalizeCollectedTakeout(watchFiles, subscriptionFiles) {
      const ignoredWatchFiles = [];
      const hasWatchJson = watchFiles.some((file) => file.name.split("/").pop().toLowerCase() === "watch-history.json");
      let watches = watchFiles;
      if (hasWatchJson) {
        const jsonFiles = watchFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "watch-history.json");
        const htmlFiles = watchFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "watch-history.html");
        ignoredWatchFiles.push(...htmlFiles.map((file) => file.name));
        if (jsonFiles.length > 1) {
          const best = pickBestNamedFile(jsonFiles, "watch-history.json");
          ignoredWatchFiles.push(...jsonFiles.filter((file) => file !== best).map((file) => file.name));
          watches = best ? [best] : jsonFiles;
        } else {
          watches = jsonFiles;
        }
      } else if (watchFiles.length > 1) {
        const best = pickBestNamedFile(watchFiles, "watch-history.html");
        ignoredWatchFiles.push(...watchFiles.filter((file) => file !== best).map((file) => file.name));
        watches = best ? [best] : watchFiles;
      }

      const csvFiles = subscriptionFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "subscriptions.csv");
      const jsonFiles = subscriptionFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "subscriptions.json");
      let subs = subscriptionFiles;
      if (csvFiles.length && jsonFiles.length) {
        subs = csvFiles.length === 1 ? csvFiles : [pickBestNamedFile(subscriptionFiles, "subscriptions.csv") || csvFiles[0]];
      } else if (subscriptionFiles.length > 1) {
        const basename = csvFiles.length ? "subscriptions.csv" : "subscriptions.json";
        const best = pickBestNamedFile(subscriptionFiles, basename);
        subs = best ? [best] : subscriptionFiles;
      }

      return { watchFiles: watches, subscriptionFiles: subs, ignoredWatchFiles };
    }

    function setParseProgress(percent, label) {
      if (!parseProgressEl || !parseProgressBarEl) {
        if (label) setStatus(label);
        return;
      }
      if (percent === null) {
        parseProgressEl.classList.remove("is-active");
        parseProgressBarEl.style.width = "0%";
        parseProgressEl.setAttribute("aria-hidden", "true");
        parseProgressEl.setAttribute("aria-valuenow", "0");
        return;
      }
      const pct = Math.round(Math.max(0, Math.min(100, percent)));
      parseProgressEl.classList.add("is-active");
      parseProgressBarEl.style.width = `${pct}%`;
      parseProgressEl.setAttribute("aria-hidden", "false");
      parseProgressEl.setAttribute("aria-valuenow", String(pct));
      if (label) {
        setStatus(label);
        parseProgressEl.setAttribute("aria-valuetext", label);
      }
    }

    function formatBytes(bytes) {
      if (!bytes) return "0 B";
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    function cloneAggregate(aggregate) {
      const copy = new Map();
      for (const [key, value] of aggregate.entries()) {
        copy.set(key, {
          ...value,
          videoKeys: new Set(value.videoKeys)
        });
      }
      return copy;
    }

    async function loadWatchHistoryAsync(files, now, runId) {
      const signature = watchFilesSignature(files);
      if (state.parsedWatch?.signature === signature) {
        return finalizeWatchAggregate(cloneAggregate(state.parsedWatch.aggregate), now);
      }
      const parsed = await aggregateWatchHistoryAsync(files, runId);
      if (runId !== state.analysisRunId) return new Map();
      state.parsedWatch = { signature, aggregate: parsed.aggregate };
      state.parseMeta = {
        skippedNoChannel: parsed.skippedNoChannel,
        duplicateWatchesSkipped: parsed.duplicateWatchesSkipped
      };
      return finalizeWatchAggregate(parsed.aggregate, now);
    }

    async function aggregateWatchHistoryAsync(files, runId) {
      const aggregate = new Map();
      const resolver = new ChannelKeyResolver();
      const seenDuplicateRows = new Set();
      let processed = 0;
      let skippedNoChannel = 0;
      let duplicateWatchesSkipped = 0;
      let entryIndex = 0;

      for (const file of files) {
        const textSize = (file.text || "").length;
        if (textSize >= 1024 * 1024) {
          setStatus(`Parsing ${file.name.split("/").pop()} (${formatBytes(textSize)})…`);
          await yieldToMain();
        }
        const entries = loadWatchHistoryEntries(file);
        for (let index = 0; index < entries.length; index += 1) {
          if (runId !== state.analysisRunId) return { aggregate, skippedNoChannel, duplicateWatchesSkipped };
          entryIndex += 1;
          const result = ingestWatchEntry(aggregate, resolver, entries[index], seenDuplicateRows, entryIndex);
          if (result === "skipped") skippedNoChannel += 1;
          if (result === "duplicate") duplicateWatchesSkipped += 1;
          processed += 1;
          if (processed % PARSE_YIELD_EVERY === 0) await yieldToMain();
        }
      }
      return { aggregate, skippedNoChannel, duplicateWatchesSkipped };
    }

    function ingestWatchEntry(aggregate, resolver, entry, seenDuplicateRows, entryIndex) {
      const channel = channelFromWatchEntry(entry);
      if (!channel) return "skipped";
      const duplicateKey = duplicateEntryKey(entry, entryIndex);
      if (seenDuplicateRows.has(duplicateKey)) return "duplicate";
      seenDuplicateRows.add(duplicateKey);
      const videoKey = uniqueVideoKey(entry, entryIndex);
      const key = resolver.resolve(channel);
      const current = aggregate.get(key) || {
        channelName: channel.name,
        channelUrl: channel.url,
        channelId: channel.channelId,
        channelKey: key,
        watchCount: 0,
        videoKeys: new Set(),
        sampleVideoId: null,
        firstWatched: null,
        lastWatched: null
      };
      current.watchCount += 1;
      current.videoKeys.add(videoKey);
      if (!current.channelUrl && channel.url) current.channelUrl = channel.url;
      if (!current.channelId && channel.channelId) current.channelId = channel.channelId;
      const videoId = extractVideoId(normalizeWatchUrl(entry.titleUrl));
      if (videoId && !current.sampleVideoId) current.sampleVideoId = videoId;
      const watchedAt = parseWatchTime(entry.time);
      if (watchedAt) {
        if (!current.firstWatched || watchedAt < current.firstWatched) current.firstWatched = watchedAt;
        if (!current.lastWatched || watchedAt > current.lastWatched) current.lastWatched = watchedAt;
      }
      aggregate.set(key, current);
      return "ok";
    }

    function finalizeWatchAggregate(aggregate, now) {
      const normalized = new Map();
      for (const [key, value] of aggregate.entries()) {
        const uniqueVideoCount = value.videoKeys.size;
        const score = scoreChannel(value.watchCount, uniqueVideoCount, value.firstWatched, value.lastWatched, now);
        normalized.set(key, {
          channelName: value.channelName,
          channelUrl: value.channelUrl,
          channelId: value.channelId,
          channelKey: key,
          watchCount: value.watchCount,
          uniqueVideoCount,
          sampleVideoId: value.sampleVideoId,
          firstWatched: value.firstWatched,
          lastWatched: value.lastWatched,
          score,
          explanation: buildExplanation(value.watchCount, uniqueVideoCount, value.firstWatched, value.lastWatched)
        });
      }
      return normalized;
    }

    function loadWatchHistoryEntries(file) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".json")) {
        try {
          const data = JSON.parse(file.text);
          if (!Array.isArray(data)) {
            console.warn(`${file.name} is not a JSON array; no watch entries were loaded.`);
            return [];
          }
          return data;
        } catch (error) {
          throw new Error(`Could not parse ${file.name}: ${error.message}`);
        }
      }
      if (lower.endsWith(".html")) return parseWatchHistoryHtml(file.text);
      return [];
    }

    function htmlToPlainLines(html) {
      return html
        .replace(/&nbsp;/gi, " ")
        .replace(/\r/g, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, "\"")
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);
    }

    function normalizeWatchUrl(url) {
      const trimmed = (url || "").trim();
      if (!trimmed) return "";
      if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return normalizeUrl(trimmed);
      const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
      return normalizeUrl(`https://www.youtube.com${path}`);
    }

    function parseWatchHistoryHtml(rawHtml) {
      const regexEntries = parseWatchHistoryHtmlCells(rawHtml);
      if (regexEntries.length) return regexEntries;
      const strict = parseWatchHistoryHtmlStrict(rawHtml);
      if (strict.length) return strict;
      return parseWatchHistoryHtmlLoose(rawHtml);
    }

    function parseWatchHistoryHtmlCells(rawHtml) {
      const blocks = extractContentCellBlocks(rawHtml);
      const entries = [];
      for (const block of blocks) {
        const entry = parseWatchHistoryHtmlBlock(block);
        if (entry) entries.push(entry);
      }
      return entries;
    }

    function extractContentCellBlocks(rawHtml) {
      const blocks = [];
      const opener = /<div[^>]*class="[^"]*content-cell[^"]*"[^>]*>/gi;
      let match = opener.exec(rawHtml);
      while (match) {
        const start = match.index + match[0].length;
        let depth = 1;
        let pos = start;
        let closeAt = start;
        while (depth > 0 && pos < rawHtml.length) {
          const nextOpen = rawHtml.indexOf("<div", pos);
          const nextClose = rawHtml.indexOf("</div>", pos);
          if (nextClose === -1) break;
          if (nextOpen !== -1 && nextOpen < nextClose) {
            depth += 1;
            pos = nextOpen + 4;
            continue;
          }
          depth -= 1;
          closeAt = nextClose;
          pos = nextClose + 6;
        }
        if (depth === 0) blocks.push(rawHtml.slice(start, closeAt));
        match = opener.exec(rawHtml);
      }
      return blocks;
    }

    function parseWatchHistoryHtmlBlock(block) {
      const links = [...block.matchAll(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi)];
      if (links.length < 2) return null;
      const titleHref = links[0][1];
      const titleText = links[0][2].replace(/<[^>]+>/g, "").trim();
      const channelHref = links[1][1];
      const channelText = links[1][2].replace(/<[^>]+>/g, "").trim();
      const lines = htmlToPlainLines(block);
      const timeLine = lines.find((line) => /\d{4}/.test(line) && /[:]/.test(line)) || "";
      const time = parseWatchTimeText(timeLine);
      if (!time) return null;
      return {
        title: titleText,
        titleUrl: normalizeWatchUrl(titleHref),
        time,
        subtitles: [{ name: channelText, url: normalizeWatchUrl(channelHref) }]
      };
    }

    function parseWatchHistoryHtmlStrict(rawHtml) {
      const doc = new DOMParser().parseFromString(rawHtml, "text/html");
      const cards = doc.querySelectorAll(".outer-cell");
      const entries = [];
      for (const card of cards) {
        const content = card.querySelector(".content-cell.mdl-cell--6-col.mdl-typography--body-1")
          || card.querySelector(".content-cell");
        if (!content) continue;
        const entry = parseWatchHistoryContentCell(content);
        if (entry) entries.push(entry);
      }
      return entries;
    }

    function parseWatchHistoryHtmlLoose(rawHtml) {
      const doc = new DOMParser().parseFromString(rawHtml, "text/html");
      const entries = [];
      doc.querySelectorAll(".content-cell").forEach((content) => {
        const entry = parseWatchHistoryContentCell(content);
        if (entry) entries.push(entry);
      });
      return entries;
    }

    function parseWatchHistoryContentCell(content) {
      const links = content.querySelectorAll("a");
      if (links.length < 2) return null;
      const titleLink = links[0];
      const channelLink = links[1];
      const lines = htmlToPlainLines(content.innerHTML);
      const timeLine = lines.find((line) => /\d{4}/.test(line) && /[:]/.test(line)) || "";
      const time = parseWatchTimeText(timeLine);
      if (!time) return null;
      return {
        title: titleLink.textContent.trim(),
        titleUrl: normalizeWatchUrl(titleLink.getAttribute("href") || ""),
        time,
        subtitles: [{
          name: channelLink.textContent.trim(),
          url: normalizeWatchUrl(channelLink.getAttribute("href") || "")
        }]
      };
    }

    class ChannelKeyResolver {
      constructor() {
        this._canonicalForKey = new Map();
        this._canonicalForName = new Map();
      }

      resolve(channel) {
        const keys = allChannelKeys(channel);
        const nameFold = channel.name ? normalizeName(channel.name) : "";
        const candidates = new Set();
        for (const key of keys) {
          if (this._canonicalForKey.has(key)) candidates.add(this._canonicalForKey.get(key));
        }
        if (nameFold && this._canonicalForName.has(nameFold) && !channelHasStableIdentity(channel) && !channel.url) {
          candidates.add(this._canonicalForName.get(nameFold));
        }

        let canonical;
        if (candidates.size === 1) {
          canonical = [...candidates][0];
        } else if (candidates.size > 1) {
          canonical = [...candidates].sort()[0];
          for (const other of [...candidates].sort().slice(1)) {
            this._mergeCanonical(other, canonical);
          }
        } else if (nameFold && this._canonicalForName.has(nameFold) && !channelHasStableIdentity(channel) && !channel.url) {
          canonical = this._canonicalForName.get(nameFold);
        } else {
          canonical = preferredCanonicalKey(channel);
        }

        this._register(channel, canonical);
        return canonical;
      }

      _mergeCanonical(oldKey, newKey) {
        for (const [key, value] of this._canonicalForKey.entries()) {
          if (value === oldKey) this._canonicalForKey.set(key, newKey);
        }
        for (const [name, value] of this._canonicalForName.entries()) {
          if (value === oldKey) this._canonicalForName.set(name, newKey);
        }
      }

      _register(channel, canonical) {
        for (const key of allChannelKeys(channel)) {
          this._canonicalForKey.set(key, canonical);
        }
        const nameFold = normalizeName(channel.name);
        if (nameFold && !channelHasStableIdentity(channel) && !channel.url) {
          this._canonicalForName.set(nameFold, canonical);
        }
      }
    }

    function channelHasStableIdentity(channel) {
      return Boolean(channel.channelId || channel.alias);
    }

    function preferredCanonicalKey(channel) {
      if (channel.channelId) return `id:${channel.channelId.toLowerCase()}`;
      if (channel.alias) return `alias:${channel.alias.toLowerCase()}`;
      if (channel.url) return `url:${normalizeUrl(channel.url)}`;
      return `name:${normalizeName(channel.name)}`;
    }

    function rewatchRatio(watchCount, uniqueVideoCount) {
      if (!uniqueVideoCount) return 0;
      return Math.round((watchCount / uniqueVideoCount) * 100) / 100;
    }

    function parseSubscriptionFiles(files) {
      const channels = [];
      const keys = new Set();
      const seen = new Set();
      for (const file of files) {
        const lower = file.name.toLowerCase();
        if (lower.endsWith(".csv")) {
          for (const row of parseCsv(file.text)) {
            const ref = buildChannelRef(
              firstPresent(row, "Channel Title", "Channel title", "Title", "Name"),
              firstPresent(row, "Channel URL", "Channel Url", "Channel URI", "URL"),
              firstPresent(row, "Channel ID", "Channel Id")
            );
            if (!subscriptionRefIsUsable(ref)) continue;
            for (const key of allChannelKeys(ref)) keys.add(key);
            const canonical = preferredCanonicalKey(ref);
            if (seen.has(canonical)) continue;
            seen.add(canonical);
            channels.push(ref);
          }
        } else if (lower.endsWith(".json")) {
          let data;
          try {
            data = JSON.parse(file.text);
          } catch (error) {
            throw new Error(`Could not parse ${file.name}: ${error.message}`);
          }
          if (!Array.isArray(data)) {
            console.warn(`${file.name} is not a JSON array; no subscription entries were loaded.`);
          }
          const items = Array.isArray(data) ? data : [];
          for (const row of items) {
            const snippet = row && typeof row === "object" ? row.snippet || {} : {};
            const resource = snippet && typeof snippet === "object" ? snippet.resourceId || {} : {};
            const ref = buildChannelRef(
              cleanName(row?.name || row?.title || row?.channelTitle || snippet?.title),
              asOptionalString(row?.url || row?.channelUrl),
              asOptionalString(row?.channelId || resource?.channelId)
            );
            if (!subscriptionRefIsUsable(ref)) continue;
            for (const key of allChannelKeys(ref)) keys.add(key);
            const canonical = preferredCanonicalKey(ref);
            if (seen.has(canonical)) continue;
            seen.add(canonical);
            channels.push(ref);
          }
        }
      }
      const hasCsv = files.some((file) => file.name.toLowerCase().endsWith(".csv"));
      const hasJson = files.some((file) => file.name.toLowerCase().endsWith(".json"));
      return { channels, keys, formatConflict: hasCsv && hasJson };
    }

    function buildWatchIndex(watchedMap) {
      const index = new Map();
      for (const stat of watchedMap.values()) {
        const ref = buildChannelRef(stat.channelName, stat.channelUrl, stat.channelId);
        for (const key of allChannelKeys(ref)) {
          const existing = index.get(key);
          if (!existing || stat.watchCount > existing.watchCount) index.set(key, stat);
        }
      }
      return index;
    }

    function findWatchStatInIndex(ref, watchIndex) {
      let best = null;
      for (const key of allChannelKeys(ref)) {
        const stat = watchIndex.get(key);
        if (stat && (!best || stat.watchCount > best.watchCount)) best = stat;
      }
      return best;
    }

    function findInactiveSubscriptions(watchIndex, subscribedChannels, recentMonths, now) {
      const cutoff = subtractCalendarMonths(now, recentMonths);
      const inactive = [];
      for (const sub of subscribedChannels) {
        const stat = findWatchStatInIndex(sub, watchIndex);
        if (stat && stat.lastWatched && stat.lastWatched >= cutoff) continue;
        inactive.push({
          channelName: sub.name,
          channelUrl: sub.url || stat?.channelUrl || null,
          channelId: sub.channelId || stat?.channelId || null,
          channelKey: preferredCanonicalKey(sub),
          watchCount: stat?.watchCount || 0,
          uniqueVideoCount: stat?.uniqueVideoCount || 0,
          firstWatched: stat?.firstWatched || null,
          lastWatched: stat?.lastWatched || null,
          score: stat?.score || 0,
          explanation: !stat || !stat.lastWatched
            ? `subscribed but no watches in last ${recentMonths} months`
            : `subscribed; last watched ${formatDate(stat.lastWatched)} (outside last ${recentMonths} months)`
        });
      }
      return inactive.sort((left, right) => {
        const leftMissing = left.lastWatched ? 1 : 0;
        const rightMissing = right.lastWatched ? 1 : 0;
        if (leftMissing !== rightMissing) return leftMissing - rightMissing;
        return left.channelName.localeCompare(right.channelName);
      });
    }

    function enrichChannelsFromSubscriptions(watchedMap, subscriptionChannels) {
      if (!subscriptionChannels.length) return;
      for (const stat of watchedMap.values()) {
        const ref = buildChannelRef(stat.channelName, stat.channelUrl, stat.channelId);
        const statKeys = new Set(allChannelKeys(ref));
        for (const sub of subscriptionChannels) {
          if (!allChannelKeys(sub).some((key) => statKeys.has(key))) continue;
          if (!stat.channelId && sub.channelId) stat.channelId = sub.channelId;
          if (!stat.channelUrl && sub.url) stat.channelUrl = sub.url;
          break;
        }
      }
    }

    function parseCsv(text) {
      const rows = [];
      const lines = text.replace(/\r/g, "").split("\n").filter(Boolean);
      if (!lines.length) return rows;
      const headers = splitCsvLine(lines[0]);
      if (!headers.length || headers.every((header) => !String(header).trim())) {
        return rows;
      }
      for (const line of lines.slice(1)) {
        const cells = splitCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
          row[header] = cells[index] || "";
        });
        rows.push(row);
      }
      return rows;
    }

    function splitCsvLine(line) {
      const cells = [];
      let current = "";
      let inQuotes = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "\"") {
          if (inQuotes && line[index + 1] === "\"") {
            current += "\"";
            index += 1;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (char === "," && !inQuotes) {
          cells.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      cells.push(current);
      return cells.map((cell) => cell.trim());
    }

    function channelFromWatchEntry(entry) {
      if (!entry || typeof entry !== "object" || !Array.isArray(entry.subtitles) || !entry.subtitles.length) return null;
      const first = entry.subtitles[0];
      const name = cleanName(first?.name);
      if (!name) return null;
      return buildChannelRef(name, asOptionalString(first?.url));
    }

    function buildChannelRef(name, url = null, channelId = null) {
      const cleanedName = cleanName(name) || "Unknown Channel";
      const cleanedUrl = url ? normalizeUrl(url) : null;
      let resolvedId = cleanName(channelId);
      let alias = null;
      if (cleanedUrl) {
        resolvedId = resolvedId || extractChannelId(cleanedUrl);
        alias = extractAlias(cleanedUrl);
      }
      return { name: cleanedName, url: cleanedUrl, channelId: resolvedId, alias };
    }

    function allChannelKeys(channel) {
      const keys = new Set();
      if (channel.channelId) keys.add(`id:${channel.channelId.toLowerCase()}`);
      if (channel.alias) {
        const alias = channel.alias.toLowerCase();
        keys.add(`alias:${alias}`);
        keys.add(`handle:${alias}`);
        keys.add(`user:${alias}`);
        keys.add(`custom:${alias}`);
      }
      if (channel.url) keys.add(`url:${normalizeUrl(channel.url)}`);
      if (channel.name) keys.add(`name:${normalizeName(channel.name)}`);
      return [...keys];
    }

    function stableChannelKey(channel) {
      return preferredCanonicalKey(channel);
    }

    function sortChannelsOnly(channels) {
      return [...channels].sort((a, b) =>
        b.score - a.score ||
        b.watchCount - a.watchCount ||
        b.uniqueVideoCount - a.uniqueVideoCount ||
        a.channelName.localeCompare(b.channelName)
      );
    }

    function scoreChannel(watchCount, uniqueVideoCount, firstWatched, lastWatched, now) {
      const diversityBonus = Math.min(uniqueVideoCount, SCORE_UNIQUE_CAP) * SCORE_UNIQUE_WEIGHT;
      let recencyBonus = 0;
      let spanBonus = 0;
      if (lastWatched) {
        const daysSince = Math.max((now - lastWatched) / 86400000, 0);
        recencyBonus = Math.max(0, SCORE_RECENCY_MAX - Math.min(daysSince / SCORE_RECENCY_DIVISOR, SCORE_RECENCY_MAX));
      }
      if (firstWatched && lastWatched) {
        const spanDays = Math.max((lastWatched - firstWatched) / 86400000, 0);
        spanBonus = Math.min(spanDays / SCORE_SPAN_DIVISOR, SCORE_SPAN_MAX);
      }
      return Math.round(((watchCount * SCORE_WATCH_WEIGHT) + diversityBonus + recencyBonus + spanBonus) * 100) / 100;
    }

    function buildExplanation(watchCount, uniqueVideoCount, firstWatched, lastWatched) {
      const parts = [
        `${watchCount} watched videos`,
        `${uniqueVideoCount} unique videos`,
        `rewatch ratio ${rewatchRatio(watchCount, uniqueVideoCount)}`
      ];
      if (uniqueVideoCount <= 1 && watchCount > 1) {
        parts.push("mostly repeat views of one video");
      }
      if (firstWatched) parts.push(`first watched ${formatDate(firstWatched)}`);
      if (lastWatched) parts.push(`last watched ${formatDate(lastWatched)}`);
      return parts.join(", ");
    }

    function channelHintFromEntry(entry) {
      const subtitles = entry?.subtitles;
      if (!Array.isArray(subtitles) || !subtitles.length) return null;
      const first = subtitles[0];
      const url = asOptionalString(first?.url);
      if (url) {
        const alias = extractAlias(url);
        if (alias) return `alias:${alias.toLowerCase()}`;
        const channelId = extractChannelId(url);
        if (channelId) return `id:${channelId.toLowerCase()}`;
      }
      const name = cleanName(first?.name);
      if (name) return `name:${normalizeName(name)}`;
      return null;
    }

    function uniqueVideoKey(entry, entryIndex = 0) {
      const titleUrl = asOptionalString(entry?.titleUrl);
      if (titleUrl) return `url:${normalizeUrl(titleUrl)}`;
      const title = cleanName(entry?.title);
      if (title) {
        const hint = channelHintFromEntry(entry);
        if (hint) return `title:${hint}:${normalizeName(title)}`;
        return `title:${normalizeName(title)}`;
      }
      return `entry:${entryIndex}`;
    }

    function duplicateEntryKey(entry, entryIndex) {
      const videoKey = uniqueVideoKey(entry, entryIndex);
      const watchedAt = parseWatchTime(entry?.time);
      if (watchedAt) return `${videoKey}|${watchedAt.toISOString()}`;
      return videoKey;
    }

    function subscriptionRefIsUsable(ref) {
      if (ref.channelId || ref.channelUrl) return true;
      return Boolean(ref.name && ref.name !== "Unknown Channel");
    }

    function parseWatchTime(value) {
      if (!value || typeof value !== "string") return null;
      const normalized = value.trim().replace("Z", "+00:00");
      const date = new Date(normalized);
      return Number.isNaN(date.valueOf()) ? null : date;
    }

    const MONTH_INDEX = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    function parseWatchTimeText(value) {
      if (!value) return null;
      let cleaned = value.trim();
      for (const [label, offset] of Object.entries(TIMEZONE_OFFSETS)) {
        cleaned = cleaned.replace(new RegExp(`\\b${label}\\b`, "gi"), offset);
      }
      cleaned = cleaned.replace(/\s+/g, " ").trim();
      const euro = cleaned.match(/^(\d{1,2}) (\w+) (\d{4}), (\d{1,2}):(\d{2}):(\d{2}) (BST|UTC|GMT)$/i);
      if (euro) {
        const month = MONTH_INDEX[euro[2].slice(0, 3).toLowerCase()];
        if (month != null) {
          let hour = Number(euro[4]);
          const offset = euro[7].toUpperCase() === "BST" ? 1 : 0;
          if (euro[7].toUpperCase() === "BST") hour -= 1;
          const date = new Date(Date.UTC(Number(euro[3]), month, Number(euro[1]), hour, Number(euro[5]), Number(euro[6])));
          if (!Number.isNaN(date.valueOf())) return date.toISOString();
        }
      }
      const parsed = new Date(cleaned.replace(/\bBST\b/g, "+0100").replace(/\bUTC\b/g, "+0000").replace(/\bGMT\b/g, "+0000"));
      if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString();
      return null;
    }

    function normalizeUrl(value) {
      const raw = (value || "").trim().replace(/\/+$/, "");
      if (!raw) return raw;
      try {
        const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "https://www.youtube.com");
        if (url.hostname === "youtube.com" || url.hostname === "m.youtube.com") url.hostname = "www.youtube.com";
        if (url.protocol === "http:") url.protocol = "https:";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
      } catch {
        return raw;
      }
    }

    function normalizeName(value) {
      return cleanName(value)?.toLowerCase() || "";
    }

    function cleanName(value) {
      if (typeof value !== "string") return null;
      const cleaned = value.replace(/\s+/g, " ").trim();
      return cleaned || null;
    }

    function asOptionalString(value) {
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }

    function firstPresent(row, ...keys) {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) normalized[normalizeLookupKey(key)] = value;
      for (const key of keys) {
        const value = normalized[normalizeLookupKey(key)];
        if (typeof value === "string" && value.trim()) return value.trim();
      }
      return null;
    }

    function normalizeLookupKey(value) {
      return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function extractChannelId(url) {
      return url.match(CHANNEL_ID_PATTERN)?.[1] || null;
    }

    function extractVideoId(url) {
      if (!url || typeof url !== "string") return null;
      const watchMatch = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
      if (watchMatch) return watchMatch[1];
      const shortMatch = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
      if (shortMatch) return shortMatch[1];
      const shortsMatch = url.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
      if (shortsMatch) return shortsMatch[1];
      return null;
    }

    function escapeAttr(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;");
    }

    function extractAlias(url) {
      return url.match(HANDLE_PATTERN)?.[1] || url.match(USER_PATTERN)?.[1] || url.match(CUSTOM_PATTERN)?.[1] || null;
    }

    let dateLocaleFormatter;

    function formatDate(value) {
      if (!value) return "";
      const date = new Date(value);
      if (Number.isNaN(date.valueOf())) return "";
      if (!dateLocaleFormatter) {
        dateLocaleFormatter = new Intl.DateTimeFormat(undefined, {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          timeZone: "UTC"
        });
      }
      return dateLocaleFormatter.format(date);
    }

    function getMinVideos() {
      return Math.max(1, Number(minVideosInput.value) || 1);
    }

    function getLimit() {
      return Math.max(1, Number(limitInput.value) || 18);
    }

    function getRecentMonths() {
      return Math.max(1, Number(recentWindowSelect.value) || 6);
    }

    function getStaleMonths() {
      return Math.max(0, Number(staleMonthsSelect?.value) || 0);
    }

    function rerenderResults() {
      if (state.currentStep !== "results") return;
      if (!state.analysis) {
        renderEmptyResults();
        return;
      }

      const now = analysisReferenceDate();
      const limit = getLimit();
      const recentCutoff = subtractCalendarMonths(now, getRecentMonths());
      const staleMonths = getStaleMonths();
      const staleCutoff = staleMonths > 0 ? subtractCalendarMonths(now, staleMonths) : null;
      const minVideos = getMinVideos();
      const matchesVisibility = (channel) => {
        const hidden = isChannelHidden(channel);
        return !hidden || state.showHidden;
      };
      const applyUnsubscribedFilters = (channels) => channels.filter((channel) => {
        if (channel.watchCount < minVideos) return false;
        if (staleCutoff && (!channel.lastWatched || channel.lastWatched < staleCutoff)) return false;
        return matchesVisibility(channel);
      });
      const applyOverallFilters = (channels) => channels.filter((channel) => {
        if (channel.watchCount < minVideos) return false;
        return matchesVisibility(channel);
      });
      const applyInactiveFilters = (channels) => channels.filter((channel) => matchesVisibility(channel));

      const overall = applyOverallFilters(state.analysis.overallChannels).slice(0, limit);
      const unsubscribed = applyUnsubscribedFilters(state.analysis.unsubscribedChannels).slice(0, limit);
      const recent = applyUnsubscribedFilters(state.analysis.unsubscribedChannels)
        .filter((channel) => channel.lastWatched && channel.lastWatched >= recentCutoff)
        .slice(0, limit);

      const topHighlights = unsubscribed.slice(0, 3);
      const inactive = applyInactiveFilters(state.analysis.inactiveSubscriptions || []).slice(0, limit);
      resultsShell.classList.add("is-visible");
      renderHero(unsubscribed, recent);
      renderStats({
        watchFiles: state.analysis.watchFileCount,
        subscriptionFiles: state.analysis.subscriptionFileCount,
        shortlist: unsubscribed.length,
        inactive: inactive.length,
        ranked: overall.length
      });
      renderHighlights(topHighlights);
      renderTable(unsubscribedTable, unsubscribed, "unsubscribedTable");
      renderTable(recentTable, recent, "recentTable");
      renderTable(inactiveTable, inactive, "inactiveTable");
      renderTable(overallTable, overall, "overallTable");
      unsubscribedTag.textContent = `${unsubscribed.length} channels`;
      recentTag.textContent = `${recent.length} recent`;
      inactiveTag.textContent = `${inactive.length} inactive`;
      overallTag.textContent = `${overall.length} ranked`;
      scheduleCsvDownloads(unsubscribed, overall, inactive);
      updateInactiveSubsLead();
      updateShowHiddenButton();
    }

    function updateInactiveSubsLead() {
      if (inactiveSubsLead) {
        inactiveSubsLead.textContent = `Still subscribed, but no watches in the last ${getInactiveRecentMonths()} months.`;
      }
    }

    function renderHero(unsubscribed, recent) {
      const top = unsubscribed[0];

      if (!top) {
        resultsHeadline.textContent = "No matches";
        resultsNarrative.textContent = "Try Explore, or lower the min. videos watched.";
        return;
      }

      const recentPhrase = recent.length ? `${recent.length} watched recently` : "none in your recent window";
      resultsHeadline.textContent = `${unsubscribed.length} channel${unsubscribed.length === 1 ? "" : "s"} found`;
      resultsNarrative.textContent =
        `Top: ${top.channelName} · ${top.watchCount} videos · ${recentPhrase}.`;
    }

    function renderStats(stats) {
      statsGrid.innerHTML = [
        statCard(stats.watchFiles, "history files"),
        statCard(stats.subscriptionFiles, "sub files"),
        statCard(stats.shortlist, "not subscribed"),
        statCard(stats.inactive || 0, "inactive subs"),
        statCard(stats.ranked, "total ranked")
      ].join("");
    }

    function statCard(value, label) {
      return `<div class="stat-card"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`;
    }

    function renderHighlights(channels) {
      if (!channels.length) {
        highlightGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">No top picks yet.</div>`;
        return;
      }
      highlightGrid.innerHTML = channels.map((channel, index) => `
        <article class="highlight-card">
          <div class="highlight-rank">${index + 1}</div>
          ${renderChannelCell(channel, { compact: true })}
          <span>${escapeHtml(channel.explanation)}</span>
          <div class="mini-meta">
            <div class="mini-tag">Score ${escapeHtml(String(channel.score))}</div>
            <div class="mini-tag">${escapeHtml(String(channel.watchCount))} watches</div>
            <div class="mini-tag">${escapeHtml(formatDate(channel.lastWatched) || "unknown")}</div>
          </div>
        </article>
      `).join("");
      hydrateChannelAvatars(highlightGrid);
    }

    const TABLE_SORT_DEFAULTS = {
      rank: "desc",
      channel: "asc",
      videos: "desc",
      unique: "desc",
      rewatch: "desc",
      score: "desc",
      first: "desc",
      last: "desc"
    };

    function sortTableChannels(channels, tableId) {
      const sort = state.tableSort[tableId];
      if (!sort) return channels;
      return [...channels].sort((a, b) => compareChannelsForSort(a, b, sort.key, sort.dir));
    }

    function compareChannelsForSort(a, b, key, dir) {
      const mul = dir === "asc" ? 1 : -1;
      const text = (value) => (value || "").toLowerCase();
      let av;
      let bv;
      switch (key) {
        case "rank":
          av = a.watchCount;
          bv = b.watchCount;
          break;
        case "score":
          av = a.score;
          bv = b.score;
          break;
        case "channel":
          av = text(a.channelName);
          bv = text(b.channelName);
          break;
        case "videos":
          av = a.watchCount;
          bv = b.watchCount;
          break;
        case "unique":
          av = a.uniqueVideoCount;
          bv = b.uniqueVideoCount;
          break;
        case "rewatch":
          av = rewatchRatio(a.watchCount, a.uniqueVideoCount);
          bv = rewatchRatio(b.watchCount, b.uniqueVideoCount);
          break;
        case "first":
          av = a.firstWatched ? a.firstWatched.getTime() : 0;
          bv = b.firstWatched ? b.firstWatched.getTime() : 0;
          break;
        case "last":
          av = a.lastWatched ? a.lastWatched.getTime() : 0;
          bv = b.lastWatched ? b.lastWatched.getTime() : 0;
          break;
        default:
          return 0;
      }
      if (av < bv) return -1 * mul;
      if (av > bv) return 1 * mul;
      return text(a.channelName).localeCompare(text(b.channelName)) * mul;
    }

    function setTableSort(tableId, sortKey) {
      const current = state.tableSort[tableId];
      let dir = TABLE_SORT_DEFAULTS[sortKey] || "desc";
      if (current?.key === sortKey) {
        dir = current.dir === "desc" ? "asc" : "desc";
      }
      state.tableSort[tableId] = { key: sortKey, dir };
      rerenderResults();
    }

    function renderSortableHeader(label, sortKey, tableId) {
      const sort = state.tableSort[tableId];
      const active = sort?.key === sortKey;
      const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
      const indicator = active ? (sort.dir === "asc" ? "↑" : "↓") : "↕";
      return `<th class="sortable${sortKey === "first" || sortKey === "last" ? " date-cell" : ""}" data-sort-key="${sortKey}" data-table-id="${tableId}" aria-sort="${ariaSort}" scope="col">${escapeHtml(label)}<span class="sort-indicator" aria-hidden="true">${indicator}</span></th>`;
    }

    function renderTable(container, channels, tableId) {
      if (!channels.length) {
        container.innerHTML = `<div class="empty">Nothing matched your filters.</div>`;
        return;
      }
      const sorted = sortTableChannels(channels, tableId);
      if (useCardLayout) {
        container.innerHTML = `<div class="channel-cards">${sorted.map((channel, index) => {
          const hidden = isChannelHidden(channel);
          return `
        <article class="channel-card ${hidden ? "is-hidden-row" : ""}">
          <div class="channel-card-head"><strong>#${index + 1}</strong></div>
          ${renderChannelCell(channel)}
          <p class="channel-card-why">${escapeHtml(channel.explanation)}</p>
          <div class="channel-card-stats">
            <span>${channel.watchCount} videos</span>
            <span>${channel.uniqueVideoCount} unique</span>
            <span>Rewatch ${rewatchRatio(channel.watchCount, channel.uniqueVideoCount)}</span>
            <span>Score ${channel.score}</span>
            <span>Last ${escapeHtml(formatDate(channel.lastWatched) || "n/a")}</span>
          </div>
          ${renderRowActions(channel)}
        </article>
      `;
        }).join("")}</div>`;
      } else {
        const rows = sorted.map((channel, index) => {
          const hidden = isChannelHidden(channel);
          return `
        <tr class="${hidden ? "is-hidden-row" : ""}">
          <td>${index + 1}</td>
          <td>
            ${renderChannelCell(channel)}
          </td>
          <td>${channel.watchCount}</td>
          <td>${channel.uniqueVideoCount}</td>
          <td>${rewatchRatio(channel.watchCount, channel.uniqueVideoCount)}</td>
          <td>${channel.score}</td>
          <td class="date-cell">${escapeHtml(formatDate(channel.firstWatched))}</td>
          <td class="date-cell">${escapeHtml(formatDate(channel.lastWatched))}</td>
          <td>${renderRowActions(channel)}</td>
        </tr>
      `;
        }).join("");
        container.innerHTML = `
        <table>
          <thead>
            <tr>
              ${renderSortableHeader("#", "rank", tableId)}
              ${renderSortableHeader("Channel", "channel", tableId)}
              ${renderSortableHeader("Videos", "videos", tableId)}
              ${renderSortableHeader("Unique", "unique", tableId)}
              ${renderSortableHeader("Rewatch", "rewatch", tableId)}
              ${renderSortableHeader("Score", "score", tableId)}
              ${renderSortableHeader("First", "first", tableId)}
              ${renderSortableHeader("Last", "last", tableId)}
              <th scope="col"></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>`;
      }
      bindRowActions(container);
      if (!useCardLayout) bindTableSort(container);
      hydrateChannelAvatars(container);
    }

    function bindTableSort(container) {
      container.querySelectorAll("th.sortable").forEach((header) => {
        header.addEventListener("click", () => {
          setTableSort(header.dataset.tableId, header.dataset.sortKey);
        });
      });
    }

    function bindRowActions(container) {
      container.querySelectorAll(".btn-hide").forEach((button) => {
        button.addEventListener("click", () => toggleHiddenChannel(button.dataset.hideKey));
      });
    }

    function buildChannelCsv(channels) {
      const header = ["rank", "score", "videos_watched", "unique_videos", "rewatch_ratio", "first_watched", "last_watched", "channel_name", "channel_url", "channel_id", "why_ranked_high"];
      const rows = channels.map((channel, index) => [
        index + 1,
        channel.score,
        channel.watchCount,
        channel.uniqueVideoCount,
        rewatchRatio(channel.watchCount, channel.uniqueVideoCount),
        formatDate(channel.firstWatched),
        formatDate(channel.lastWatched),
        channel.channelName,
        channel.channelUrl || "",
        channel.channelId || "",
        channel.explanation
      ]);
      return [header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n");
    }

    function scheduleCsvDownloads(unsubscribed, overall, inactive) {
      clearTimeout(state.csvDownloadTimer);
      state.csvDownloadTimer = setTimeout(() => {
        void updateCsvDownloads(unsubscribed, overall, inactive);
      }, 300);
    }

    async function updateCsvDownloads(unsubscribed, overall, inactive) {
      if (!downloadCsvButton || typeof JSZip === "undefined") return;
      const zip = new JSZip();
      zip.file("subsleuth-results.csv", buildChannelCsv(unsubscribed));
      zip.file("subsleuth-top-channels.csv", buildChannelCsv(overall));
      zip.file("subsleuth-inactive-subs.csv", buildChannelCsv(inactive));
      const blob = await zip.generateAsync({ type: "blob" });
      if (state.csvUrl && state.csvUrl !== "#") URL.revokeObjectURL(state.csvUrl);
      state.csvUrl = URL.createObjectURL(blob);
      downloadCsvButton.href = state.csvUrl;
      downloadCsvButton.download = "subsleuth-export.zip";
    }

    function renderEmptyResults() {
      resultsShell.classList.add("is-visible");
      resultsHeadline.textContent = "Results go here";
      resultsNarrative.textContent = "Upload your export and run the check first.";
      statsGrid.innerHTML = [
        statCard(0, "history files"),
        statCard(0, "sub files"),
        statCard(0, "not subscribed"),
        statCard(0, "inactive subs"),
        statCard(0, "total ranked")
      ].join("");
      highlightGrid.innerHTML = `<div class="empty" style="grid-column:1/-1">Top picks show up after you run.</div>`;
      [unsubscribedTable, recentTable, inactiveTable, overallTable].forEach((table) => {
        table.innerHTML = `<div class="empty">Run the check to see results.</div>`;
      });
      unsubscribedTag.textContent = "0 channels";
      recentTag.textContent = "0 recent";
      inactiveTag.textContent = "0 inactive";
      overallTag.textContent = "0 ranked";
    }

    function summarizeFiles(files, verb) {
      const takeoutFiles = files.filter(isTakeoutDataFile);
      if (takeoutFiles.length) {
        const names = takeoutFiles.slice(0, 3).map((file) => getFileRelativePath(file).split("/").pop()).join(", ");
        const suffix = takeoutFiles.length > 3 ? ` +${takeoutFiles.length - 3} more` : "";
        return `${takeoutFiles.length} Takeout file(s) ${verb}: ${names}${suffix}`;
      }
      const names = files.slice(0, 3).map((file) => getFileRelativePath(file)).join(", ");
      const suffix = files.length > 3 ? ` +${files.length - 3} more` : "";
      return `${files.length} file(s) ${verb}: ${names}${suffix}`;
    }

    function setStatus(message) {
      statusEl.textContent = message;
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    function csvEscape(value) {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
    }

    function demoVideoId(seed) {
      const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
      let hash = 0;
      for (let index = 0; index < seed.length; index += 1) {
        hash = ((hash << 5) - hash + seed.charCodeAt(index)) | 0;
      }
      let id = "";
      for (let index = 0; index < 11; index += 1) {
        hash = ((hash << 5) - hash + index) | 0;
        id += alphabet[Math.abs(hash) % alphabet.length];
      }
      return id;
    }

    function makeWatchEntry(channelName, channelUrl, time, title) {
      return {
        title,
        titleUrl: `https://www.youtube.com/watch?v=${demoVideoId(`${channelName}:${title}:${time}`)}`,
        time,
        subtitles: [{ name: channelName, url: channelUrl }]
      };
    }

    function loadSettings() {
      try {
        const raw = localStorage.getItem(STORAGE_SETTINGS);
        if (!raw) {
          applyPreset("balanced");
          return;
        }
        const settings = JSON.parse(raw);
        if (settings.preset) applyPreset(settings.preset);
        if (settings.minVideos) minVideosInput.value = settings.minVideos;
        if (settings.limit) limitInput.value = settings.limit;
        if (settings.recentMonths) recentWindowSelect.value = String(settings.recentMonths);
        if (settings.staleMonths != null && staleMonthsSelect) staleMonthsSelect.value = String(settings.staleMonths);
        if (settings.inactiveMonths != null && inactiveMonthsSelect) {
          inactiveMonthsSelect.value = String(settings.inactiveMonths);
        }
        if (localOnlyAvatarsInput) {
          localOnlyAvatarsInput.checked = Boolean(settings.localOnlyAvatars);
        }
      } catch {
        applyPreset("balanced");
      }
    }

    function saveSettings() {
      const preset = presetInputs.find((input) => input.checked)?.value || "balanced";
      localStorage.setItem(STORAGE_SETTINGS, JSON.stringify({
        preset,
        minVideos: minVideosInput.value,
        limit: limitInput.value,
        recentMonths: recentWindowSelect.value,
        staleMonths: staleMonthsSelect?.value || "0",
        inactiveMonths: inactiveMonthsSelect?.value || "6",
        localOnlyAvatars: Boolean(localOnlyAvatarsInput?.checked)
      }));
    }

    function avatarsDisabled() {
      return Boolean(localOnlyAvatarsInput?.checked);
    }

    function openIdb() {
      if (!idbPromise) {
        idbPromise = new Promise((resolve, reject) => {
          const request = indexedDB.open(IDB_NAME, 1);
          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
          };
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => {
            idbPromise = null;
            reject(request.error);
          };
        });
      }
      return idbPromise;
    }

    async function compressForStorage(value) {
      if (typeof CompressionStream === "undefined") {
        return { schemaVersion: CACHE_SCHEMA_VERSION, compressed: false, payload: value };
      }
      const bytes = new TextEncoder().encode(JSON.stringify(value));
      const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
      const buffer = await new Response(stream).arrayBuffer();
      return { schemaVersion: CACHE_SCHEMA_VERSION, compressed: true, payload: new Uint8Array(buffer) };
    }

    async function decompressFromStorage(stored) {
      if (!stored) return null;
      if (stored.watchFiles) return stored;
      if (!stored.compressed) return stored.payload ?? stored;
      if (typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot decompress cached imports. Re-upload your Takeout files.");
      }
      const stream = new Blob([stored.payload]).stream().pipeThrough(new DecompressionStream("gzip"));
      const text = await new Response(stream).text();
      return JSON.parse(text);
    }

    async function idbSaveRaw(rawFiles) {
      const wrapped = await compressForStorage(rawFiles);
      return idbPutValue(IDB_KEY, wrapped);
    }

    async function idbLoadRaw() {
      const stored = await idbGetValue(IDB_KEY);
      return decompressFromStorage(stored);
    }

    async function idbPutValue(key, value) {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    async function idbGetValue(key) {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const request = tx.objectStore(IDB_STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    }

    async function idbDeleteValue(key) {
      const db = await openIdb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    }

    async function saveSession() {
      let analysisPayload = null;
      if (state.analysis) {
        const serialized = serializeAnalysis(state.analysis);
        const json = JSON.stringify(serialized);
        if (json.length > SESSION_ANALYSIS_LOCAL_MAX) {
          try {
            await idbPutValue(IDB_ANALYSIS_KEY, serialized);
            analysisPayload = { idb: true };
          } catch {
            analysisPayload = serialized;
          }
        } else {
          analysisPayload = serialized;
          try {
            await idbDeleteValue(IDB_ANALYSIS_KEY);
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          await idbDeleteValue(IDB_ANALYSIS_KEY);
        } catch {
          /* ignore */
        }
      }

      const payload = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        currentStep: state.currentStep,
        maxStepIndex: state.maxStepIndex,
        uploadedFileNames: state.uploadedFileNames,
        fileDiagnostics: state.fileDiagnostics,
        importSizeBytes: state.importSizeBytes,
        analysis: analysisPayload,
        isDemo: state.isDemo
      };
      let cacheWarning = null;
      try {
        localStorage.setItem(STORAGE_SESSION, JSON.stringify(payload));
      } catch {
        cacheWarning = "Could not save session metadata locally.";
      }

      if (!state.rawFiles.watchFiles.length && !state.rawFiles.subscriptionFiles.length) {
        state.cacheWarning = cacheWarning;
        return;
      }

      try {
        await idbSaveRaw(state.rawFiles);
      } catch {
        cacheWarning = cacheWarning || "Could not cache this import locally. If you refresh, you will need to upload again.";
      }
      state.cacheWarning = cacheWarning;
    }

    async function restoreSession() {
      try {
        const raw = localStorage.getItem(STORAGE_SESSION);
        if (!raw) return;
        const session = JSON.parse(raw);
        if (session.schemaVersion != null && session.schemaVersion !== CACHE_SCHEMA_VERSION) {
          await clearAllLocalData();
          return;
        }
        if (Array.isArray(session.uploadedFileNames)) state.uploadedFileNames = session.uploadedFileNames;
        if (typeof session.maxStepIndex === "number") state.maxStepIndex = session.maxStepIndex;
        if (session.fileDiagnostics) state.fileDiagnostics = session.fileDiagnostics;
        if (session.importSizeBytes) state.importSizeBytes = session.importSizeBytes;
        if (typeof session.isDemo === "boolean") state.isDemo = session.isDemo;
        else state.isDemo = state.uploadedFileNames.includes(DEMO_UPLOAD_LABEL);

        try {
          const cachedRaw = await idbLoadRaw();
          if (cachedRaw) state.rawFiles = cachedRaw;
        } catch (error) {
          state.cacheWarning = error?.message || "Could not restore cached import. Re-upload if you want to re-run with new rules.";
        }

        if (session.analysis) {
          if (session.analysis.idb) {
            const cachedAnalysis = await idbGetValue(IDB_ANALYSIS_KEY);
            if (cachedAnalysis) state.analysis = deserializeAnalysis(cachedAnalysis);
          } else {
            state.analysis = deserializeAnalysis(session.analysis);
          }
          if (!hasCachedImport()) {
            state.cacheWarning = state.cacheWarning || "Results restored, but the original import is not cached. Re-upload to re-run with new rules.";
          }
          setWizardStep(session.currentStep || "results");
          if (hasCachedImport() && state.uploadedFileNames.length) {
            setStatus(`Restored: ${state.uploadedFileNames.join(", ")}\nChange settings anytime. No re-upload needed.`);
          }
          renderUploadFileList();
          return;
        }
        if (session.currentStep) setWizardStep(session.currentStep);
        renderUploadFileList();
      } catch {
        /* ignore corrupt session */
      }
    }

    function renderCacheWarnings() {
      const html = state.cacheWarning
        ? `<div class="callout callout-warn"><strong>Cache note</strong>${escapeHtml(state.cacheWarning)}</div>`
        : "";
      if (cacheWarningEl) cacheWarningEl.innerHTML = html;
      if (resultsCacheWarningEl) resultsCacheWarningEl.innerHTML = state.analysis ? html : "";
    }

    function subscribeUrl(channel) {
      if (channel.channelId) {
        return `https://www.youtube.com/channel/${channel.channelId}?sub_confirmation=1`;
      }
      if (channel.channelUrl) {
        try {
          const url = new URL(channel.channelUrl);
          url.searchParams.set("sub_confirmation", "1");
          return url.toString();
        } catch {
          const alias = extractAlias(channel.channelUrl);
          if (alias) return `https://www.youtube.com/@${alias}?sub_confirmation=1`;
        }
      }
      const ref = buildChannelRef(channel.channelName, channel.channelUrl, channel.channelId);
      if (ref.alias) return `https://www.youtube.com/@${ref.alias}?sub_confirmation=1`;
      return null;
    }

    function renderRowActions(channel) {
      const hidden = isChannelHidden(channel);
      const key = escapeHtml(channelStorageKey(channel));
      const sub = subscribeUrl(channel);
      const subBtn = sub
        ? `<a class="btn-subscribe" href="${escapeHtml(sub)}" target="_blank" rel="noreferrer">Subscribe</a>`
        : "";
      return `<div class="row-actions">${subBtn}<button type="button" class="btn-hide" data-hide-key="${key}">${hidden ? "Unhide" : "Hide"}</button></div>`;
    }

    function serializeAnalysis(analysis) {
      const mapChannel = (channel) => ({
        ...channel,
        firstWatched: channel.firstWatched ? channel.firstWatched.toISOString() : null,
        lastWatched: channel.lastWatched ? channel.lastWatched.toISOString() : null
      });
      return {
        overallChannels: analysis.overallChannels.map(mapChannel),
        unsubscribedChannels: analysis.unsubscribedChannels.map(mapChannel),
        inactiveSubscriptions: (analysis.inactiveSubscriptions || []).map(mapChannel),
        subscriptionChannels: analysis.subscriptionChannels || [],
        watchFileCount: analysis.watchFileCount,
        subscriptionFileCount: analysis.subscriptionFileCount,
        diagnostics: analysis.diagnostics || null,
        analyzedAt: analysis.analyzedAt || null
      };
    }

    function deserializeAnalysis(analysis) {
      const mapChannel = (channel) => ({
        ...channel,
        firstWatched: channel.firstWatched ? new Date(channel.firstWatched) : null,
        lastWatched: channel.lastWatched ? new Date(channel.lastWatched) : null
      });
      return {
        overallChannels: analysis.overallChannels.map(mapChannel),
        unsubscribedChannels: analysis.unsubscribedChannels.map(mapChannel),
        inactiveSubscriptions: (analysis.inactiveSubscriptions || []).map(mapChannel),
        subscriptionChannels: analysis.subscriptionChannels || [],
        watchFileCount: analysis.watchFileCount,
        subscriptionFileCount: analysis.subscriptionFileCount,
        diagnostics: analysis.diagnostics || null,
        analyzedAt: analysis.analyzedAt || null
      };
    }

    async function updateUploadStatus(verb) {
      state.isDemo = false;
      state.importSizeBytes = state.uploadedFiles.reduce((sum, file) => sum + (file.size || 0), 0);
      if (state.importSizeBytes > MAX_UPLOAD_BYTES) {
        setStatus(`Upload is too large (${formatBytes(state.importSizeBytes)}). Try the .zip only, or use the CLI.`);
        return;
      }
      setStatus(summarizeFiles(state.uploadedFiles, verb));
      invalidateParsedWatch();
      try {
        const rawFiles = await collectInputFiles(state.uploadedFiles, setParseProgress);
        state.rawFiles = rawFiles;
        state.fileDiagnostics = buildFileDiagnostics(rawFiles);
        renderUploadDiagnostics(state.fileDiagnostics);
        await saveSession();
      } catch (error) {
        setStatus(error?.message || "Could not read the uploaded files.");
        await clearImportState({ keepStep: true });
      } finally {
        setParseProgress(null);
        renderCacheWarnings();
        renderDemoCta();
        renderUploadFileList();
      }
    }

    function clearUploadDiagnostics() {
      state.fileDiagnostics = null;
      if (uploadDiagnosticsEl) uploadDiagnosticsEl.innerHTML = "";
    }

    function buildFileDiagnostics(rawFiles, parseMeta = null) {
      const watchJson = [];
      const watchHtml = [];
      for (const file of rawFiles.watchFiles) {
        const base = file.name.split("/").pop().toLowerCase();
        if (base.endsWith(".json")) watchJson.push(file.name);
        else if (base.endsWith(".html")) watchHtml.push(file.name);
      }
      const foundWatch = [...watchJson, ...watchHtml];
      const foundSub = rawFiles.subscriptionFiles.map((file) => file.name);
      const subCsv = rawFiles.subscriptionFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "subscriptions.csv");
      const subJson = rawFiles.subscriptionFiles.filter((file) => file.name.split("/").pop().toLowerCase() === "subscriptions.json");
      const missing = [];
      if (!foundWatch.length) missing.push("watch-history.json or watch-history.html");
      if (!foundSub.length) missing.push("subscriptions.csv or subscriptions.json");
      let totalWatchBytes = 0;
      let largeJsonBytes = 0;
      for (const file of rawFiles.watchFiles) {
        const bytes = (file.text || "").length * 2;
        totalWatchBytes += bytes;
        const base = file.name.split("/").pop().toLowerCase();
        if (base === "watch-history.json" && bytes > largeJsonBytes) largeJsonBytes = bytes;
      }
      let memoryWarning = null;
      if (totalWatchBytes > LARGE_EXPORT_BYTES) {
        memoryWarning = `Large watch history (${formatBytes(totalWatchBytes)}). Parsing may use a lot of memory.`;
      }
      if (largeJsonBytes >= 1024 * 1024) {
        const jsonNote = `Large watch-history.json (${formatBytes(largeJsonBytes)}). Parsing may briefly pause the tab.`;
        memoryWarning = memoryWarning ? `${memoryWarning} ${jsonNote}` : jsonNote;
      }
      const usingHtmlFallback = !watchJson.length && watchHtml.length > 0;
      const meta = parseMeta || state.parseMeta || {};
      return {
        foundWatch,
        foundSub,
        watchJson,
        watchHtml,
        missing,
        ok: !missing.length,
        watchFileCount: foundWatch.length,
        totalWatchBytes,
        usingHtmlFallback,
        memoryWarning,
        subscriptionFormatConflict: subCsv.length > 0 && subJson.length > 0,
        skippedNoChannel: meta.skippedNoChannel || 0,
        duplicateWatchesSkipped: meta.duplicateWatchesSkipped || 0,
        ignoredWatchFiles: state.ignoredWatchFiles || [],
        missingSubscriptions: !foundSub.length && foundWatch.length > 0
      };
    }

    function renderUploadDiagnostics(diag) {
      if (!uploadDiagnosticsEl || !diag) {
        if (uploadDiagnosticsEl) uploadDiagnosticsEl.innerHTML = "";
        return;
      }
      let html = "";
      if (diag.missing.length) {
        html += `<div class="callout callout-error"><strong>Missing</strong><ul class="diag-list">${diag.missing.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
      }
      if (diag.usingHtmlFallback) {
        html += `<div class="callout callout-warn"><strong>HTML fallback</strong>No watch-history.json found. Using watch-history.html instead.</div>`;
      }
      if (diag.missingSubscriptions) {
        html += `<div class="callout callout-warn"><strong>No subscriptions file</strong>Every watched channel will look unsubscribed until you add subscriptions.csv or subscriptions.json.</div>`;
      }
      if (diag.ignoredWatchFiles?.length) {
        html += `<div class="callout callout-info"><strong>Ignored watch files</strong>${escapeHtml(diag.ignoredWatchFiles.map((name) => name.split("/").pop()).join(", "))}</div>`;
      }
      if (diag.subscriptionFormatConflict) {
        html += `<div class="callout callout-warn"><strong>Subscription formats</strong>Both subscriptions.csv and subscriptions.json were found. Using CSV.</div>`;
      }
      if (diag.memoryWarning) {
        html += `<div class="callout callout-warn"><strong>Memory</strong>${escapeHtml(diag.memoryWarning)}</div>`;
      }
      if (diag.skippedNoChannel) {
        html += `<div class="callout callout-info"><strong>Skipped entries</strong>${diag.skippedNoChannel} watch entries had no channel name or URL.</div>`;
      }
      if (diag.duplicateWatchesSkipped) {
        html += `<div class="callout callout-info"><strong>Duplicate rows skipped</strong>${diag.duplicateWatchesSkipped} duplicate Takeout rows (same video and timestamp).</div>`;
      }
      const found = [...diag.foundWatch, ...diag.foundSub];
      if (found.length) {
        html += `<div class="callout callout-info"><strong>Found</strong><ul class="diag-list">${found.map((name) => `<li><code>${escapeHtml(name.split("/").pop())}</code></li>`).join("")}</ul></div>`;
      }
      uploadDiagnosticsEl.innerHTML = html;
    }

    function formatAnalysisStatus(rawFiles, analysis) {
      const diag = state.fileDiagnostics || buildFileDiagnostics(rawFiles);
      const shortlistCount = analysis.unsubscribedChannels.filter((channel) => channel.watchCount >= getMinVideos()).length;
      const lines = [
        `Watch files: ${diag.watchFileCount || rawFiles.watchFiles.length}`,
        `Subscription files: ${rawFiles.subscriptionFiles.length}`,
        `Shortlist: ${shortlistCount} (${analysis.unsubscribedChannels.length} before min-videos filter)`,
        `Inactive subs: ${(analysis.inactiveSubscriptions || []).length}`
      ];
      if (diag.missingSubscriptions) lines.push("Warning: no subscriptions file. Every watched channel will look unsubscribed.");
      if (diag.usingHtmlFallback) lines.push("Using watch-history.html (no JSON found).");
      if (diag.ignoredWatchFiles?.length) lines.push(`Ignored extra watch files: ${diag.ignoredWatchFiles.map((n) => n.split("/").pop()).join(", ")}.`);
      if (diag.memoryWarning) lines.push(diag.memoryWarning);
      if (diag.subscriptionFormatConflict) lines.push("Both subscription CSV and JSON found; using CSV.");
      if (diag.skippedNoChannel) lines.push(`Skipped ${diag.skippedNoChannel} watch entries with no channel.`);
      if (diag.duplicateWatchesSkipped) lines.push(`Skipped ${diag.duplicateWatchesSkipped} duplicate Takeout rows (same video and timestamp).`);
      if (diag.missing.length) lines.push(`Missing: ${diag.missing.join(", ")}`);
      return lines.join("\n");
    }

    function getHiddenChannels() {
      if (state.hiddenChannels) return state.hiddenChannels;
      try {
        const raw = localStorage.getItem(STORAGE_HIDDEN);
        state.hiddenChannels = raw ? new Set(JSON.parse(raw)) : new Set();
      } catch {
        state.hiddenChannels = new Set();
      }
      return state.hiddenChannels;
    }

    function saveHiddenChannels(hidden) {
      state.hiddenChannels = hidden;
      localStorage.setItem(STORAGE_HIDDEN, JSON.stringify([...hidden]));
    }

    function channelStorageKey(channel) {
      if (channel.channelKey) return channel.channelKey;
      const ref = buildChannelRef(channel.channelName, channel.channelUrl, channel.channelId);
      return stableChannelKey(ref);
    }

    function isChannelHidden(channel) {
      return getHiddenChannels().has(channelStorageKey(channel));
    }

    function toggleHiddenChannel(key) {
      const hidden = getHiddenChannels();
      if (hidden.has(key)) hidden.delete(key);
      else hidden.add(key);
      saveHiddenChannels(hidden);
      updateShowHiddenButton();
      if (state.analysis) rerenderResults();
    }

    function updateShowHiddenButton() {
      const count = getHiddenChannels().size;
      if (!count) {
        showHiddenButton.hidden = true;
        return;
      }
      showHiddenButton.hidden = false;
      showHiddenButton.textContent = state.showHidden ? `Hide reviewed (${count})` : `Show hidden (${count})`;
    }

    function demoAvatarForChannel(channel) {
      if (channel.channelId && DEMO_AVATAR_BY_ID[channel.channelId]) {
        return DEMO_AVATAR_BY_ID[channel.channelId];
      }
      const normalizedName = channel.channelName ? channel.channelName.trim().toLowerCase() : "";
      if (normalizedName && DEMO_AVATAR_BY_NAME[normalizedName]) {
        return DEMO_AVATAR_BY_NAME[normalizedName];
      }
      return null;
    }

    function bannerYtAvatarUrl(identifier) {
      if (!identifier) return null;
      return `https://banner.yt/api/banner/${identifier}?type=avatar&format=jpeg&width=88&height=88`;
    }

    function proxiedAvatarUrl(targetUrl) {
      return `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&w=88&h=88&fit=cover&output=jpg`;
    }

    function youtubeVideoThumbUrl(videoId) {
      if (!videoId) return null;
      return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
    }

    function channelAvatarLookup(channel) {
      if (channel.channelId) return channel.channelId;
      if (channel.channelUrl) {
        const channelId = extractChannelId(channel.channelUrl);
        if (channelId) return channelId;
        const alias = extractAlias(channel.channelUrl);
        if (alias) return alias;
        const user = channel.channelUrl.match(USER_PATTERN)?.[1];
        if (user) return user;
        const custom = channel.channelUrl.match(CUSTOM_PATTERN)?.[1];
        if (custom) return custom;
      }
      const normalizedName = channel.channelName ? channel.channelName.trim().toLowerCase() : "";
      if (normalizedName && DEMO_HANDLE_BY_NAME[normalizedName]) {
        return DEMO_HANDLE_BY_NAME[normalizedName];
      }
      return null;
    }

    function getChannelAvatarCandidates(channel) {
      if (avatarsDisabled()) return [];
      const candidates = [];
      const demoAvatar = demoAvatarForChannel(channel);
      if (demoAvatar) candidates.push(demoAvatar);

      const lookup = channelAvatarLookup(channel);
      if (lookup) {
        const bannerUrl = bannerYtAvatarUrl(lookup);
        candidates.push(proxiedAvatarUrl(bannerUrl));
        candidates.push(bannerUrl);
      }

      const videoThumb = youtubeVideoThumbUrl(channel.sampleVideoId);
      if (videoThumb) candidates.push(videoThumb);

      return [...new Set(candidates)];
    }

    function channelAvatarUrl(channel) {
      const candidates = getChannelAvatarCandidates(channel);
      return candidates[0] || null;
    }

    function hydrateChannelAvatars(root) {
      if (!root || avatarsDisabled()) return;
      const run = () => hydrateChannelAvatarsNow(root);
      if (typeof requestIdleCallback === "function") {
        requestIdleCallback(run, { timeout: 240 });
      } else {
        setTimeout(run, 0);
      }
    }

    function hydrateChannelAvatarsNow(root) {
      if (!root || avatarsDisabled()) return;
      if (root._avatarAbort) root._avatarAbort.abort();
      const abort = new AbortController();
      root._avatarAbort = abort;
      root.querySelectorAll("img.channel-avatar[data-avatar-candidates]").forEach((img) => {
        let candidates = [];
        try {
          candidates = JSON.parse(img.dataset.avatarCandidates || "[]");
        } catch {
          candidates = img.src ? [img.src] : [];
        }
        if (!candidates.length) return;

        let candidateIndex = 0;
        const showFallback = () => {
          img.hidden = true;
          const fallback = img.nextElementSibling;
          if (fallback?.classList.contains("channel-avatar-fallback")) fallback.hidden = false;
        };
        const hideFallback = () => {
          img.hidden = false;
          const fallback = img.nextElementSibling;
          if (fallback?.classList.contains("channel-avatar-fallback")) fallback.hidden = true;
        };

        const tryNext = () => {
          candidateIndex += 1;
          if (candidateIndex >= candidates.length) {
            showFallback();
            return;
          }
          img.src = candidates[candidateIndex];
        };

        img.addEventListener("error", tryNext, { signal: abort.signal });
        img.addEventListener("load", () => {
          if (img.naturalWidth > 0) hideFallback();
          else tryNext();
        }, { signal: abort.signal });

        if (img.complete) {
          if (img.naturalWidth > 0) hideFallback();
          else tryNext();
        }
      });
    }

    function channelInitials(name) {
      const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
      if (!parts.length) return "?";
      if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
      return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
    }

    function renderChannelCell(channel, options = {}) {
      const avatarCandidates = getChannelAvatarCandidates(channel);
      const avatarUrl = avatarCandidates[0] || null;
      const initials = escapeHtml(channelInitials(channel.channelName));
      const nameHtml = channel.channelUrl
        ? `<a href="${escapeHtml(channel.channelUrl)}" target="_blank" rel="noreferrer">${escapeHtml(channel.channelName)}</a>`
        : escapeHtml(channel.channelName);
      const avatar = avatarUrl
        ? `<img class="channel-avatar" data-avatar-candidates="${escapeAttr(JSON.stringify(avatarCandidates))}" src="${escapeAttr(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer" decoding="async">`
        : "";
      const fallback = `<div class="channel-avatar-fallback"${avatarUrl ? " hidden" : ""}>${initials}</div>`;
      const detail = options.compact ? "" : `<small>${escapeHtml(channel.explanation)}</small>`;
      return `<div class="channel-cell">${avatar}${fallback}<div class="channel-meta"><strong>${nameHtml}</strong>${detail}</div></div>`;
    }

    function downloadHtmlReport() {
      if (!state.analysis) return;
      const html = buildHtmlReport(getReportData());
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "subsleuth-report.html";
      link.click();
      URL.revokeObjectURL(url);
    }

    function getReportData() {
      const now = analysisReferenceDate();
      const limit = getLimit();
      const recentMonths = getRecentMonths();
      const staleMonths = getStaleMonths();
      const inactiveMonths = getInactiveRecentMonths();
      const minVideos = getMinVideos();
      const recentCutoff = subtractCalendarMonths(now, recentMonths);
      const staleCutoff = staleMonths > 0 ? subtractCalendarMonths(now, staleMonths) : null;
      const exportVisible = (channel) => !isChannelHidden(channel);
      const notStale = (channel) => !staleCutoff || (channel.lastWatched && channel.lastWatched >= staleCutoff);
      const meetsMinVideos = (channel) => channel.watchCount >= minVideos;
      const unsubscribed = state.analysis.unsubscribedChannels
        .filter(exportVisible)
        .filter(meetsMinVideos)
        .filter(notStale)
        .slice(0, limit);
      const overall = state.analysis.overallChannels
        .filter(exportVisible)
        .filter(meetsMinVideos)
        .slice(0, limit);
      const recent = unsubscribed
        .filter((channel) => channel.lastWatched && channel.lastWatched >= recentCutoff)
        .slice(0, limit);
      const inactive = (state.analysis.inactiveSubscriptions || [])
        .filter(exportVisible)
        .slice(0, limit);
      return { unsubscribed, overall, recent, inactive, recentMonths, staleMonths, inactiveMonths, analysis: state.analysis };
    }

    function buildHtmlReportChannelCell(channel) {
      const nameHtml = channel.channelUrl
        ? `<a href="${escapeHtml(channel.channelUrl)}">${escapeHtml(channel.channelName)}</a>`
        : escapeHtml(channel.channelName);
      if (avatarsDisabled()) {
        const initials = escapeHtml(channelInitials(channel.channelName));
        return `<div class="channel-cell"><div class="channel-avatar-fallback">${initials}</div><span>${nameHtml}</span></div>`;
      }
      const avatarUrl = channelAvatarUrl(channel);
      const avatar = avatarUrl
        ? `<img class="channel-avatar" src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">`
        : "";
      return `<div class="channel-cell">${avatar}<span>${nameHtml}</span></div>`;
    }

    function buildHtmlReportTable(channels) {
      if (!channels.length) return "<p class=\"hint\">No channels in this section.</p>";
      const rows = channels.map((channel, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${buildHtmlReportChannelCell(channel)}</td>
          <td>${channel.watchCount}</td>
          <td>${channel.uniqueVideoCount}</td>
          <td>${rewatchRatio(channel.watchCount, channel.uniqueVideoCount)}</td>
          <td>${channel.score}</td>
          <td class="date-cell">${escapeHtml(formatDate(channel.firstWatched))}</td>
          <td class="date-cell">${escapeHtml(formatDate(channel.lastWatched))}</td>
          <td>${escapeHtml(channel.explanation || "")}</td>
        </tr>
      `).join("");
      return `<table><thead><tr><th>#</th><th>Channel</th><th>Videos</th><th>Unique</th><th>Rewatch</th><th>Score</th><th>First</th><th>Last</th><th>Why</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

    function buildHtmlReportImportNotes(diag) {
      if (!diag) return "";
      const notes = [];
      if (diag.usingHtmlFallback) notes.push("Parsed watch-history.html because no watch-history.json was found.");
      if (diag.subscriptionFormatConflict) notes.push("Both subscriptions.csv and subscriptions.json were found; CSV was used.");
      if (diag.ignoredWatchFiles?.length) {
        notes.push(`Ignored extra watch-history files: ${diag.ignoredWatchFiles.map((n) => n.split("/").pop()).join(", ")}`);
      }
      if (diag.missingSubscriptions) notes.push("No subscriptions file was found; every watched channel will look unsubscribed.");
      if (diag.skippedNoChannel) notes.push(`${diag.skippedNoChannel} watch entries had no channel name or URL.`);
      if (diag.duplicateWatchesSkipped) notes.push(`${diag.duplicateWatchesSkipped} duplicate Takeout rows (same video and timestamp) were skipped.`);
      if (diag.memoryWarning) notes.push(diag.memoryWarning);
      if (!notes.length) return "";
      return `<ul class="hint">${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}</ul>`;
    }

    function buildHtmlReport(data) {
      const generated = new Date().toISOString().slice(0, 19).replace("T", " ");
      const { unsubscribed, overall, recent, inactive, recentMonths, staleMonths, inactiveMonths, analysis } = data;
      const diag = analysis.diagnostics || state.fileDiagnostics;
      const highlights = unsubscribed.slice(0, 3).map((channel, index) => `
        <li><strong>${index + 1}. ${escapeHtml(channel.channelName)}</strong>: ${channel.watchCount} videos, rewatch ${rewatchRatio(channel.watchCount, channel.uniqueVideoCount)}, score ${channel.score}, last watched ${escapeHtml(formatDate(channel.lastWatched) || "unknown")}</li>
      `).join("");
      const staleNote = staleMonths > 0 ? ` Stale filter: last ${staleMonths} months.` : "";
      return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SubSleuth Report</title>
<style>
  :root { --bg:#f6f1e8; --card:#fffdf8; --ink:#1f1b16; --muted:#6a6257; --accent:#a33f1f; --line:#ded4c6; }
  body { margin:0; font-family:Georgia,"Times New Roman",serif; background:radial-gradient(circle at top,#fff8ec 0%,var(--bg) 60%); color:var(--ink); }
  .wrap { max-width:1200px; margin:0 auto; padding:32px 20px 60px; }
  .hero,.card { background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:0 10px 30px rgba(45,35,24,.08); }
  .hero { padding:28px; margin-bottom:20px; }
  h1,h2 { margin:0 0 12px; line-height:1.1; }
  h1 { font-size:2.2rem; }
  p,li,.hint { color:var(--muted); }
  .stats { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:12px; margin-top:20px; }
  .stat { padding:14px; border-radius:14px; background:#fff8ec; border:1px solid var(--line); }
  .grid { display:grid; gap:20px; }
  .card { padding:22px; }
  table { width:100%; border-collapse:collapse; font-size:.95rem; }
  th,td { text-align:left; vertical-align:top; padding:10px 8px; border-bottom:1px solid var(--line); }
  th { position:sticky; top:0; background:var(--card); font-size:.75rem; text-transform:uppercase; color:var(--muted); }
  a { color:var(--accent); }
  .channel-cell { display:flex; align-items:center; gap:10px; }
  .channel-avatar { width:32px; height:32px; border-radius:50%; object-fit:cover; flex-shrink:0; background:#eef0f3; }
</style></head><body><div class="wrap">
<section class="hero">
  <h1>SubSleuth Report</h1>
  <p>Channels you watched a lot but do not appear in your current subscription list.</p>
  <p class="hint">Generated ${generated}. Recent window: last ${recentMonths} months.${staleNote}</p>
  <div class="stats">
    <div class="stat"><strong>${diag?.watchFileCount || analysis.watchFileCount}</strong><br>watch history files</div>
    <div class="stat"><strong>${analysis.subscriptionFileCount}</strong><br>subscription files</div>
    <div class="stat"><strong>${unsubscribed.length}</strong><br>not subscribed</div>
    <div class="stat"><strong>${inactive.length}</strong><br>inactive subscriptions</div>
    <div class="stat"><strong>${analysis.overallChannels.length}</strong><br>ranked overall</div>
  </div>
  ${buildHtmlReportImportNotes(diag)}
</section>
<div class="grid">
  <section class="card">
    <h2>Top picks</h2>
    <ul>${highlights || "<li>No highlights.</li>"}</ul>
  </section>
  <section class="card">
    <h2>Likely accidental unsubscribes</h2>
    <p class="hint">Ranked by watch count, unique videos, recency, and repeat viewing.</p>
    ${buildHtmlReportTable(unsubscribed)}
  </section>
  <section class="card">
    <h2>Watched recently (last ${recentMonths} months)</h2>
    <p class="hint">${recent.length} channels from the not-subscribed list.</p>
    ${buildHtmlReportTable(recent)}
  </section>
  <section class="card">
    <h2>Inactive subscriptions</h2>
    <p class="hint">Still subscribed, but no watches in the last ${inactiveMonths} months.</p>
    ${buildHtmlReportTable(inactive)}
  </section>
  <section class="card">
    <h2>Top channels overall</h2>
    <p class="hint">Includes channels you still subscribe to.</p>
    ${buildHtmlReportTable(overall)}
  </section>
</div>
<p class="hint">Exported from SubSleuth (browser-only).</p>
</div></body></html>`;
    }
