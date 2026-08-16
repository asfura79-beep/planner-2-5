(function () {
  const STORAGE_KEY = "planner:v2";
  const LEGACY_STORAGE_KEY = "planner:v1";
  const DATA_VERSION = 2;
  const DEFAULT_THEME = "light";
  const FINISHED_TTL_DAYS = 30;
  const UNDO_TIMEOUT_MS = 8000;

  const shell = document.querySelector(".app-shell");
  const currentDate = document.querySelector("#currentDate");
  const themeToggle = document.querySelector("#themeToggle");
  const settingsToggle = document.querySelector("#settingsToggle");
  const settingsMenu = document.querySelector("#settingsMenu");
  const storageWarning = document.querySelector("#storageWarning");
  const exportDataButton = document.querySelector("#exportDataButton");
  const importDataButton = document.querySelector("#importDataButton");
  const importDataInput = document.querySelector("#importDataInput");
  const resetDataButton = document.querySelector("#resetDataButton");
  const clearFinishedButton = document.querySelector("#clearFinishedButton");
  const addTaskButton = document.querySelector("#addTaskButton");
  const taskFormPanel = document.querySelector("#taskFormPanel");
  const taskForm = document.querySelector("#taskForm");
  const taskFormError = document.querySelector("#taskFormError");
  const cancelTaskForm = document.querySelector("#cancelTaskForm");
  const undoToast = document.querySelector("#undoToast");
  const undoCompleteButton = document.querySelector("#undoCompleteButton");
  const todayTasks = document.querySelector("#todayTasks");
  const overdueTasks = document.querySelector("#overdueTasks");
  const ideasTasks = document.querySelector("#ideasTasks");
  const todayEmpty = document.querySelector("#todayEmpty");
  const overdueEmpty = document.querySelector("#overdueEmpty");
  const ideasEmpty = document.querySelector("#ideasEmpty");
  const todayCounter = document.querySelector("#todayCounter");
  const todayUrgentCounter = document.querySelector("#todayUrgentCounter");
  const weekCounter = document.querySelector("#weekCounter");
  const overdueCounter = document.querySelector("#overdueCounter");
  const ideasCounter = document.querySelector("#ideasCounter");
  const weekList = document.querySelector("#weekList");
  const filterToggle = document.querySelector("#filterToggle");
  const filterPanel = document.querySelector("#filterPanel");
  const seriesScopeModal = document.querySelector("#seriesScopeModal");
  const seriesScopeText = document.querySelector("#seriesScopeText");
  const seriesSingleButton = document.querySelector("#seriesSingleButton");
  const seriesAllButton = document.querySelector("#seriesAllButton");
  const seriesCancelButton = document.querySelector("#seriesCancelButton");
  const categoryFilterInputs = Array.from(document.querySelectorAll('input[name="category-filter"]'));
  const priorityFilterInputs = Array.from(document.querySelectorAll('input[name="priority-filter"]'));

  let memoryData = null;
  let storageAvailable = true;
  let appState = null;
  let undoTaskId = null;
  let undoGeneratedTaskId = null;
  let undoTimer = null;
  let draggedTaskId = null;
  let seriesScopeResolve = null;
  const expandedWeekDays = new Set();

  const labels = {
    weekdays: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
    category: {
      work: "Работа",
      personal: "Личное",
    },
    priority: {
      urgent: "Срочно",
      normal: "Обычно",
      later: "Можно позже",
    },
    repeatRule: {
      none: "Не повторять",
      daily: "Каждый день",
      weekly: "Каждую неделю",
      weekdays: "По будням",
      monthly: "Каждый месяц",
    },
  };

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function toISODate(date) {
    return [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-");
  }

  function addDays(date, amount) {
    const next = new Date(date);
    next.setDate(next.getDate() + amount);
    return next;
  }

  function addMonths(date, amount) {
    const next = new Date(date);
    const originalDay = next.getDate();
    next.setDate(1);
    next.setMonth(next.getMonth() + amount);
    const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(originalDay, lastDay));
    return next;
  }

  function parseISODate(dateString) {
    const parts = dateString.split("-").map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function getStartOfWeek(date) {
    const start = new Date(date);
    const day = start.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + diff);
    start.setHours(0, 0, 0, 0);
    return start;
  }

  function getWeekDays(date) {
    const start = getStartOfWeek(date);

    return labels.weekdays.map((name, index) => {
      const day = addDays(start, index);
      return {
        name,
        date: day,
        iso: toISODate(day),
      };
    });
  }

  function getUpcomingDays(date, count) {
    return Array.from({ length: count }, (_, index) => {
      const day = addDays(date, index + 1);
      return {
        name: labels.weekdays[(day.getDay() + 6) % 7],
        date: day,
        iso: toISODate(day),
      };
    });
  }

  function createId(prefix) {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function formatCurrentDate(date) {
    return new Intl.DateTimeFormat("ru-RU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(date);
  }

  function formatDate(dateString) {
    if (!dateString) {
      return "";
    }

    const date = parseISODate(dateString);

    return new Intl.DateTimeFormat("ru-RU", {
      day: "numeric",
      month: "long",
    }).format(date);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function createTask(overrides) {
    const timestamp = nowISO();

    return {
      id: createId("task"),
      title: "",
      description: "",
      dueDate: null,
      time: null,
      myDayDate: null,
      category: "personal",
      priority: "normal",
      status: "active",
      completedAt: null,
      cancelledAt: null,
      repeatRule: "none",
      seriesId: null,
      order: 10,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  function createDefaultSettings() {
    return {
      theme: DEFAULT_THEME,
      filters: {
        category: "all",
        priority: "all",
      },
      demoSeeded: false,
      resetWasUsed: false,
    };
  }

  function createDemoTasks() {
    const today = new Date();
    const todayISO = toISODate(today);
    const tomorrowISO = toISODate(addDays(today, 1));

    return [
      createTask({
        title: "Проверить план на сегодня",
        dueDate: todayISO,
        time: null,
        myDayDate: todayISO,
        category: "personal",
        priority: "normal",
        order: 10,
      }),
      createTask({
        title: "Добавить первую рабочую задачу",
        dueDate: tomorrowISO,
        time: "10:00",
        myDayDate: tomorrowISO,
        category: "work",
        priority: "later",
        order: 20,
      }),
    ];
  }

  function createInitialData(options) {
    const shouldSeedDemo = Boolean(options && options.seedDemo);
    const resetWasUsed = Boolean(options && options.resetWasUsed);
    const settings = createDefaultSettings();
    settings.demoSeeded = shouldSeedDemo;
    settings.resetWasUsed = resetWasUsed;

    return {
      version: DATA_VERSION,
      tasks: shouldSeedDemo ? createDemoTasks() : [],
      settings,
    };
  }

  function normalizeStatus(task) {
    if (["completed", "cancelled", "active"].includes(task.status)) {
      return task.status;
    }

    return task.completed ? "completed" : "active";
  }

  function normalizePriority(task) {
    if (["urgent", "normal", "later"].includes(task.priority)) {
      return task.priority;
    }

    if (["urgent", "normal", "later"].includes(task.urgency)) {
      return task.urgency;
    }

    return "normal";
  }

  function normalizeRepeat(task) {
    if (["none", "daily", "weekly", "weekdays", "monthly"].includes(task.repeatRule)) {
      return task.repeatRule;
    }

    if (["none", "daily", "weekly", "weekdays", "monthly"].includes(task.repeat)) {
      return task.repeat;
    }

    return "none";
  }

  function normalizeTask(task, index) {
    const status = normalizeStatus(task);
    const dueDate = task.dueDate || task.date || null;
    const myDayDate = task.myDayDate || dueDate || null;
    const repeatRule = normalizeRepeat(task);
    const seriesId = task.seriesId || task.repeatParentId || (repeatRule !== "none" ? createId("series") : null);

    return createTask({
      id: task.id || createId("task"),
      title: String(task.title || "").trim(),
      description: task.description ? String(task.description) : "",
      dueDate,
      time: task.time || null,
      myDayDate,
      category: task.category === "work" ? "work" : "personal",
      priority: normalizePriority(task),
      status,
      completedAt: status === "completed" ? task.completedAt || null : null,
      cancelledAt: status === "cancelled" ? task.cancelledAt || null : null,
      repeatRule,
      seriesId,
      order: Number.isFinite(Number(task.order)) ? Number(task.order) : (index + 1) * 10,
      createdAt: task.createdAt || nowISO(),
      updatedAt: task.updatedAt || nowISO(),
    });
  }

  function migrateData(data) {
    if (!data || typeof data !== "object") {
      throw new Error("Некорректная структура данных.");
    }

    if (data.version === DATA_VERSION && Array.isArray(data.tasks) && data.settings) {
      return {
        version: DATA_VERSION,
        tasks: data.tasks.map(normalizeTask),
        settings: {
          ...createDefaultSettings(),
          ...data.settings,
          filters: createDefaultSettings().filters,
          theme: data.settings.theme === "dark" ? "dark" : "light",
        },
      };
    }

    if (Array.isArray(data.tasks)) {
      return {
        version: DATA_VERSION,
        tasks: data.tasks.map(normalizeTask),
        settings: {
          ...createDefaultSettings(),
          ...(data.settings || {}),
          filters: createDefaultSettings().filters,
          theme: data.settings && data.settings.theme === "dark" ? "dark" : "light",
        },
      };
    }

    throw new Error("Не удалось выполнить миграцию данных.");
  }

  function isFinishedOlderThan(task, days, now) {
    const finishedAt = task.status === "completed" ? task.completedAt : task.cancelledAt;

    if (!finishedAt || (task.status !== "completed" && task.status !== "cancelled")) {
      return false;
    }

    const finishedTime = new Date(finishedAt).getTime();

    if (!Number.isFinite(finishedTime)) {
      return false;
    }

    return now.getTime() - finishedTime > days * 24 * 60 * 60 * 1000;
  }

  function cleanupFinishedTasks(data, now) {
    return {
      ...data,
      tasks: data.tasks.filter((task) => !isFinishedOlderThan(task, FINISHED_TTL_DAYS, now)),
    };
  }

  function showStorageWarning(show) {
    if (storageWarning) {
      storageWarning.hidden = !show;
    }
  }

  function getStoredItem(key) {
    if (!storageAvailable) {
      return memoryData ? JSON.stringify(memoryData) : null;
    }

    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      storageAvailable = false;
      showStorageWarning(true);
      return memoryData ? JSON.stringify(memoryData) : null;
    }
  }

  function setStoredItem(key, value) {
    memoryData = JSON.parse(value);

    if (!storageAvailable) {
      showStorageWarning(true);
      return false;
    }

    try {
      window.localStorage.setItem(key, value);
      showStorageWarning(false);
      return true;
    } catch (error) {
      storageAvailable = false;
      showStorageWarning(true);
      return false;
    }
  }

  function saveData() {
    setStoredItem(STORAGE_KEY, JSON.stringify(appState));
  }

  function loadData() {
    const current = getStoredItem(STORAGE_KEY);
    const legacy = current ? null : getStoredItem(LEGACY_STORAGE_KEY);
    let data;

    if (current || legacy) {
      try {
        data = migrateData(JSON.parse(current || legacy));
      } catch (error) {
        storageAvailable = false;
        showStorageWarning(true);
        data = createInitialData({ seedDemo: false, resetWasUsed: false });
      }
    } else {
      data = createInitialData({ seedDemo: true, resetWasUsed: false });
    }

    data = cleanupFinishedTasks(data, new Date());
    data.settings.filters = createDefaultSettings().filters;
    appState = data;
    ensureUpcomingRepeatsForAll();
    saveData();
    return appState;
  }

  function setCurrentDate() {
    const today = new Date();
    currentDate.dateTime = toISODate(today);
    currentDate.textContent = formatCurrentDate(today);
  }

  function setTheme(theme, options) {
    const normalizedTheme = theme === "dark" ? "dark" : "light";
    shell.dataset.theme = normalizedTheme;
    const isDark = normalizedTheme === "dark";
    themeToggle.textContent = isDark ? "Светлая тема" : "Темная тема";
    themeToggle.setAttribute("aria-pressed", String(isDark));

    if (options && options.save && appState) {
      appState.settings.theme = normalizedTheme;
      saveData();
    }
  }

  function toggleSettings(forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : settingsMenu.hidden;
    settingsMenu.hidden = !shouldOpen;
    settingsToggle.setAttribute("aria-expanded", String(shouldOpen));
  }

  function toggleFilters(forceOpen) {
    const shouldOpen = typeof forceOpen === "boolean" ? forceOpen : filterPanel.hidden;
    filterPanel.hidden = !shouldOpen;
    filterToggle.setAttribute("aria-expanded", String(shouldOpen));
  }

  function showTaskForm() {
    taskFormPanel.hidden = false;
    taskForm.reset();
    hideFormError();
    document.querySelector("#taskTitle").focus();
  }

  function hideTaskForm() {
    taskFormPanel.hidden = true;
    taskForm.reset();
    hideFormError();
  }

  function getFilters() {
    const selectedCategory = categoryFilterInputs.find((input) => input.checked);
    const selectedPriority = priorityFilterInputs.find((input) => input.checked);

    return {
      category: selectedCategory ? selectedCategory.value : "all",
      priority: selectedPriority ? selectedPriority.value : "all",
    };
  }

  function applyFilters(tasks) {
    const filters = getFilters();

    return tasks.filter((task) => {
      const categoryMatches = filters.category === "all" || task.category === filters.category;
      const priorityMatches = filters.priority === "all" || task.priority === filters.priority;
      return categoryMatches && priorityMatches;
    });
  }

  function showFormError(message) {
    taskFormError.textContent = message;
    taskFormError.hidden = false;
  }

  function hideFormError() {
    taskFormError.textContent = "";
    taskFormError.hidden = true;
  }

  function getFormValue(form, name) {
    const value = form.elements[name].value.trim();
    return value || null;
  }

  function getNextOrder() {
    return appState.tasks.reduce((max, task) => Math.max(max, Number(task.order) || 0), 0) + 10;
  }

  function getNextOrderForDate(date) {
    return appState.tasks
      .filter((task) => task.myDayDate === date && !task.time && task.status === "active")
      .reduce((max, task) => Math.max(max, Number(task.order) || 0), 0) + 10;
  }

  function validateTaskInput(values) {
    if (!values.title) {
      return "Введите название задачи.";
    }

    if (values.title.length > 120) {
      return "Название не должно быть длиннее 120 символов.";
    }

    if (values.description && values.description.length > 1000) {
      return "Описание не должно быть длиннее 1000 символов.";
    }

    if (values.time && !values.dueDate && !values.myDayDate) {
      return "Время можно задать только вместе со сроком или датой планирования.";
    }

    return "";
  }

  function collectTaskFormValues(form) {
    const dueDate = getFormValue(form, "dueDate");
    const myDayDate = getFormValue(form, "myDayDate") || dueDate;
    const repeatRule = getFormValue(form, "repeatRule") || "none";

    return {
      title: getFormValue(form, "title"),
      description: getFormValue(form, "description") || "",
      dueDate,
      myDayDate,
      time: getFormValue(form, "time"),
      category: getFormValue(form, "category") || "personal",
      priority: getFormValue(form, "priority") || "normal",
      repeatRule,
      seriesId: repeatRule === "none" ? null : createId("series"),
    };
  }

  function collectDateFormValues(form, fieldName) {
    const value = getFormValue(form, fieldName);

    return {
      [fieldName]: value,
    };
  }

  function addTask(values) {
    const task = createTask({
      ...values,
      order: getNextOrder(),
    });
    appState.tasks.push(task);
    ensureUpcomingRepeatTasks(task);
    saveData();
    render();
    return task;
  }

  function findTask(id) {
    return appState.tasks.find((task) => task.id === id);
  }

  function updateTask(id, values) {
    const task = findTask(id);

    if (!task) {
      return null;
    }

    Object.assign(task, values, { updatedAt: nowISO() });

    if (task.repeatRule !== "none" && !task.seriesId) {
      task.seriesId = createId("series");
    }

    if (task.repeatRule === "none") {
      task.seriesId = null;
    }

    if (task.status === "active" && task.repeatRule !== "none") {
      ensureUpcomingRepeatTasks(task);
    }

    saveData();
    render();
    return task;
  }

  function applySeriesUpdate(task, values) {
    appState.tasks.forEach((item) => {
      if (item.status === "active" && item.seriesId === task.seriesId) {
        Object.assign(item, values, { updatedAt: nowISO() });
        if (item.repeatRule === "none") {
          item.seriesId = null;
        } else if (!item.seriesId) {
          item.seriesId = task.seriesId || createId("series");
        }
      }
    });
    ensureUpcomingRepeatsForAll();
    saveData();
    render();
  }

  function askSeriesScope(message) {
    if (seriesScopeResolve) {
      seriesScopeResolve("cancel");
    }

    seriesScopeText.textContent = message;
    seriesScopeModal.hidden = false;
    seriesSingleButton.focus();

    return new Promise((resolve) => {
      seriesScopeResolve = resolve;
    });
  }

  function resolveSeriesScope(scope) {
    if (!seriesScopeResolve) {
      return;
    }

    const resolve = seriesScopeResolve;
    seriesScopeResolve = null;
    seriesScopeModal.hidden = true;
    resolve(scope);
  }

  function completeTask(id) {
    const sourceTask = findTask(id);
    const task = updateTask(id, {
      status: "completed",
      completedAt: nowISO(),
      cancelledAt: null,
    });

    if (!task) {
      return;
    }

    showUndo(id);

    if (sourceTask && sourceTask.repeatRule !== "none") {
      const nextTask = createNextRepeatTask(sourceTask);
      undoGeneratedTaskId = nextTask ? nextTask.id : null;
    }
  }

  function getNextRepeatDate(task, todayDate) {
    const base = task.dueDate ? parseISODate(task.dueDate) : todayDate;
    let next = getSingleNextRepeatDate(base, task.repeatRule);
    const todayISO = toISODate(todayDate);

    while (toISODate(next) <= todayISO) {
      next = getSingleNextRepeatDate(next, task.repeatRule);
    }

    return toISODate(next);
  }

  function getSingleNextRepeatDate(date, repeatRule) {
    if (repeatRule === "daily") {
      return addDays(date, 1);
    }

    if (repeatRule === "weekly") {
      return addDays(date, 7);
    }

    if (repeatRule === "weekdays") {
      let next = addDays(date, 1);
      while (next.getDay() === 0 || next.getDay() === 6) {
        next = addDays(next, 1);
      }
      return next;
    }

    if (repeatRule === "monthly") {
      return addMonths(date, 1);
    }

    return addDays(date, 1);
  }

  function createNextRepeatTask(task) {
    const nextDate = getNextRepeatDate(task, new Date());
    const seriesId = task.seriesId || createId("series");

    if (!task.seriesId) {
      task.seriesId = seriesId;
    }

    const existingNextTask = appState.tasks.find((item) => {
      const displayDate = item.myDayDate || item.dueDate;
      return item.status === "active" && item.seriesId === seriesId && displayDate === nextDate;
    });

    if (existingNextTask) {
      ensureUpcomingRepeatTasks(existingNextTask);
      saveData();
      render();
      return null;
    }

    appState.tasks.push(createTask({
      id: createId("task"),
      title: task.title,
      description: task.description,
      dueDate: nextDate,
      time: task.time,
      myDayDate: nextDate,
      category: task.category,
      priority: task.priority,
      repeatRule: task.repeatRule,
      seriesId,
      order: getNextOrder(),
    }));
    const nextTask = appState.tasks[appState.tasks.length - 1];
    ensureUpcomingRepeatTasks(nextTask);
    saveData();
    render();
    return nextTask;
  }

  function ensureUpcomingRepeatsForAll() {
    appState.tasks
      .filter((task) => task.status === "active" && task.repeatRule !== "none")
      .slice()
      .forEach(ensureUpcomingRepeatTasks);
  }

  function ensureUpcomingRepeatTasks(sourceTask) {
    if (!sourceTask || sourceTask.status !== "active" || sourceTask.repeatRule === "none") {
      return [];
    }

    const startISO = sourceTask.dueDate || sourceTask.myDayDate;

    if (!startISO) {
      return [];
    }

    if (!sourceTask.seriesId) {
      sourceTask.seriesId = createId("series");
    }

    const today = new Date();
    const todayISO = toISODate(today);
    const horizonEndISO = toISODate(addDays(today, 7));
    const existingDates = new Set(
      appState.tasks
        .filter((task) => task.status === "active" && task.seriesId === sourceTask.seriesId)
        .map((task) => task.myDayDate || task.dueDate)
        .filter(Boolean)
    );
    const generated = [];
    let nextDate;

    if (startISO < todayISO) {
      nextDate = parseISODate(getNextRepeatDate(sourceTask, today));
    } else {
      nextDate = getSingleNextRepeatDate(parseISODate(startISO), sourceTask.repeatRule);
    }

    while (toISODate(nextDate) <= horizonEndISO) {
      const nextISO = toISODate(nextDate);

      if (nextISO > todayISO && !existingDates.has(nextISO)) {
        const generatedTask = createTask({
          title: sourceTask.title,
          description: sourceTask.description,
          dueDate: nextISO,
          time: sourceTask.time,
          myDayDate: nextISO,
          category: sourceTask.category,
          priority: sourceTask.priority,
          repeatRule: sourceTask.repeatRule,
          seriesId: sourceTask.seriesId,
          order: getNextOrderForDate(nextISO),
        });
        appState.tasks.push(generatedTask);
        existingDates.add(nextISO);
        generated.push(generatedTask);
      }

      nextDate = getSingleNextRepeatDate(nextDate, sourceTask.repeatRule);
    }

    return generated;
  }

  function undoComplete() {
    if (!undoTaskId) {
      return;
    }

    updateTask(undoTaskId, {
      status: "active",
      completedAt: null,
    });

    if (undoGeneratedTaskId) {
      appState.tasks = appState.tasks.filter((task) => task.id !== undoGeneratedTaskId);
      saveData();
      render();
    }

    clearUndo();
  }

  function showUndo(id) {
    clearUndo();
    undoTaskId = id;
    undoToast.hidden = false;
    undoTimer = window.setTimeout(clearUndo, UNDO_TIMEOUT_MS);
  }

  function clearUndo() {
    if (undoTimer) {
      window.clearTimeout(undoTimer);
    }

    undoTimer = null;
    undoTaskId = null;
    undoGeneratedTaskId = null;
    undoToast.hidden = true;
  }

  function cancelTask(id) {
    updateTask(id, {
      status: "cancelled",
      cancelledAt: nowISO(),
      completedAt: null,
    });
  }

  async function deleteTask(id) {
    const task = findTask(id);
    if (!task) {
      return;
    }

    if (task.repeatRule !== "none" && task.seriesId) {
      const scope = await askSeriesScope("Удалить только эту задачу или всю серию?");

      if (scope === "cancel") {
        return;
      }

      const confirmed = window.confirm("Удалить задачу? Это действие нельзя отменить.");

      if (!confirmed) {
        return;
      }

      if (scope === "series") {
        appState.tasks = appState.tasks.filter((item) => item.status !== "active" || item.seriesId !== task.seriesId);
      } else {
        appState.tasks = appState.tasks.filter((item) => item.id !== id);
      }

      saveData();
      render();
      return;
    }

    const confirmed = window.confirm("Удалить задачу? Это действие нельзя отменить.");

    if (!confirmed) {
      return;
    }

    appState.tasks = appState.tasks.filter((task) => task.id !== id);
    saveData();
    render();
  }

  function clearFinishedTasks() {
    const confirmed = window.confirm("Удалить все выполненные и отмененные задачи? Это действие нельзя отменить.");

    if (!confirmed) {
      return;
    }

    appState.tasks = appState.tasks.filter((task) => task.status === "active");
    saveData();
    render();
    toggleSettings(false);
  }

  function exportData() {
    const payload = JSON.stringify(appState, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `planner-backup-${toISODate(new Date())}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toggleSettings(false);
  }

  function importData(file) {
    if (!file) {
      return;
    }

    const confirmed = window.confirm("Импорт заменит текущие задачи и настройки. Продолжить?");

    if (!confirmed) {
      importDataInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", function () {
      try {
        const imported = migrateData(JSON.parse(String(reader.result)));
        appState = cleanupFinishedTasks(imported, new Date());
        appState.settings.filters = createDefaultSettings().filters;
        saveData();
        setTheme(appState.settings.theme);
        render();
        toggleSettings(false);
      } catch (error) {
        window.alert("Не удалось импортировать файл. Проверьте, что это корректная резервная копия планировщика.");
      } finally {
        importDataInput.value = "";
      }
    });
    reader.readAsText(file);
  }

  function resetData() {
    const confirmed = window.confirm("Удалить все задачи и настройки? Это действие нельзя отменить.");

    if (!confirmed) {
      return;
    }

    appState = createInitialData({ seedDemo: false, resetWasUsed: true });
    setTheme(appState.settings.theme);
    saveData();
    render();
    toggleSettings(false);
  }

  function isOverdue(task, todayISO) {
    return task.status === "active" && task.dueDate && task.dueDate < todayISO;
  }

  function isTodayTask(task, todayISO) {
    return task.status === "active" && task.myDayDate === todayISO && !isOverdue(task, todayISO);
  }

  function isIdeaTask(task) {
    return task.status === "active" && !task.dueDate && !task.myDayDate;
  }

  function isWeekTask(task, todayISO) {
    if (task.status !== "active" || isTodayTask(task, todayISO) || isOverdue(task, todayISO)) {
      return false;
    }

    const weekDays = getUpcomingDays(new Date(), 7);
    const weekStart = weekDays[0].iso;
    const weekEnd = weekDays[weekDays.length - 1].iso;
    const displayDate = task.myDayDate || task.dueDate;

    if (!displayDate) {
      return false;
    }

    return displayDate >= weekStart && displayDate <= weekEnd;
  }

  function sortTasks(tasks) {
    return [...tasks].sort((a, b) => {
      if (a.time && b.time && a.time !== b.time) {
        return a.time.localeCompare(b.time);
      }

      if (a.time && !b.time) {
        return -1;
      }

      if (!a.time && b.time) {
        return 1;
      }

      return (Number(a.order) || 0) - (Number(b.order) || 0);
    });
  }

  function splitTimedTasks(tasks) {
    return {
      timed: sortTasks(tasks.filter((task) => task.time)),
      untimed: sortTasks(tasks.filter((task) => !task.time)),
    };
  }

  function render() {
    const todayISO = toISODate(new Date());
    const activeTasks = appState.tasks.filter((task) => task.status === "active");
    const todayAll = activeTasks.filter((task) => isTodayTask(task, todayISO));
    const overdueAll = activeTasks.filter((task) => isOverdue(task, todayISO));
    const ideasAll = activeTasks.filter(isIdeaTask);
    const weekAll = activeTasks.filter((task) => isWeekTask(task, todayISO));
    const today = applyFilters(todayAll);
    const overdue = applyFilters(overdueAll);
    const ideas = applyFilters(ideasAll);
    const week = applyFilters(weekAll);

    renderTaskGroups(todayTasks, today);
    renderTaskGroups(overdueTasks, overdue);
    renderTaskGroups(ideasTasks, ideas);
    renderWeek(week);

    todayEmpty.hidden = today.length > 0;
    overdueEmpty.hidden = overdue.length > 0;
    ideasEmpty.hidden = ideas.length > 0;

    todayCounter.textContent = formatCounter(today.length);
    todayUrgentCounter.textContent = `${today.filter((task) => task.priority === "urgent").length} срочных`;
    weekCounter.textContent = formatCounter(week.length);
    overdueCounter.textContent = formatCounter(overdue.length);
    ideasCounter.textContent = formatCounter(ideas.length);
  }

  function formatCounter(count) {
    if (count === 1) {
      return "1 задача";
    }

    if (count > 1 && count < 5) {
      return `${count} задачи`;
    }

    return `${count} задач`;
  }

  function renderTaskGroups(container, tasks) {
    container.innerHTML = renderTaskGroupsMarkup(tasks);
  }

  function renderTaskGroupsMarkup(tasks) {
    const groups = splitTimedTasks(tasks);
    const parts = [];

    if (groups.timed.length) {
      parts.push(renderTaskGroup("По времени", groups.timed));
    }

    if (groups.untimed.length) {
      parts.push(renderTaskGroup("Без времени", groups.untimed));
    }

    return parts.join("");
  }

  function renderTaskGroup(title, tasks) {
    return `
      <div class="task-group">
        <p class="task-group__title">${title}</p>
        ${tasks.map(renderTaskCard).join("")}
      </div>
    `;
  }

  function renderWeek(tasks) {
    const days = getUpcomingDays(new Date(), 7);
    const tasksByDay = new Map(days.map((day) => [day.iso, []]));

    tasks.forEach((task) => {
      const displayDate = task.myDayDate || task.dueDate;
      if (tasksByDay.has(displayDate)) {
        tasksByDay.get(displayDate).push(task);
      }
    });

    weekList.innerHTML = days.map((day) => renderWeekDay(day, tasksByDay.get(day.iso))).join("");
  }

  function renderWeekDay(day, tasks) {
    const isExpanded = expandedWeekDays.has(day.iso);
    const contentId = `dayTasks-${day.iso}`;

    return `
      <article class="day-row ${isExpanded ? "is-expanded" : ""}" data-drop-date="${escapeHtml(day.iso)}">
        <button
          class="day-row__toggle"
          type="button"
          data-week-toggle="${escapeHtml(day.iso)}"
          aria-expanded="${String(isExpanded)}"
          aria-controls="${escapeHtml(contentId)}"
        >
          <div>
            <h3>${day.name}</h3>
            <p>${escapeHtml(formatDate(day.iso))}</p>
          </div>
          <span class="day-row__count">${tasks.length}</span>
        </button>
        ${isExpanded && tasks.length ? `<div class="task-list" id="${escapeHtml(contentId)}">${renderTaskGroupsMarkup(tasks)}</div>` : ""}
      </article>
    `;
  }

  function renderTaskCard(task) {
    return `
      <article class="task-card" data-task-id="${escapeHtml(task.id)}" draggable="true">
        <div class="task-card__top">
          <div>
            <h3>${escapeHtml(task.title)}</h3>
            ${task.description ? `<p class="task-description">${escapeHtml(task.description)}</p>` : ""}
          </div>
        </div>
        <div class="task-meta">
          ${task.time ? `<span>${escapeHtml(task.time)}</span>` : ""}
          ${task.dueDate ? `<span>Дедлайн: ${escapeHtml(formatDate(task.dueDate))}</span>` : ""}
          ${task.myDayDate && task.myDayDate !== task.dueDate ? `<span>План: ${escapeHtml(formatDate(task.myDayDate))}</span>` : ""}
          <span class="tag tag--${escapeHtml(task.category)}">${labels.category[task.category]}</span>
          <span class="tag tag--${escapeHtml(task.priority)}">${labels.priority[task.priority]}</span>
          ${task.repeatRule !== "none" ? `<span>${labels.repeatRule[task.repeatRule]}</span>` : ""}
        </div>
        <div class="card-actions">
          <button type="button" data-action="complete">Выполнить</button>
          <button type="button" data-action="cancel">Отменить задачу</button>
          <button type="button" data-action="move">Перенести в другой день</button>
          <button type="button" data-action="change-due">Изменить дедлайн</button>
          <button type="button" data-action="edit">Редактировать</button>
          <button type="button" data-action="delete">Удалить</button>
        </div>
      </article>
    `;
  }

  function renderEditForm(card, task) {
    card.innerHTML = `
      <form class="edit-form" data-edit-form>
        <div class="form-grid">
          <label class="field field--wide">
            <span>Название</span>
            <input name="title" type="text" maxlength="120" value="${escapeHtml(task.title)}" />
          </label>
          <label class="field field--wide">
            <span>Описание</span>
            <textarea name="description" maxlength="1000" rows="3">${escapeHtml(task.description)}</textarea>
          </label>
          <label class="field">
            <span>Дедлайн</span>
            <input name="dueDate" type="date" value="${escapeHtml(task.dueDate || "")}" />
          </label>
          <label class="field">
            <span>День выполнения</span>
            <input name="myDayDate" type="date" value="${escapeHtml(task.myDayDate || "")}" />
          </label>
          <label class="field">
            <span>Время</span>
            <input name="time" type="time" value="${escapeHtml(task.time || "")}" />
          </label>
          <label class="field">
            <span>Категория</span>
            <select name="category">
              <option value="personal" ${task.category === "personal" ? "selected" : ""}>Личное</option>
              <option value="work" ${task.category === "work" ? "selected" : ""}>Работа</option>
            </select>
          </label>
          <label class="field">
            <span>Приоритет</span>
            <select name="priority">
              <option value="normal" ${task.priority === "normal" ? "selected" : ""}>Обычно</option>
              <option value="urgent" ${task.priority === "urgent" ? "selected" : ""}>Срочно</option>
              <option value="later" ${task.priority === "later" ? "selected" : ""}>Можно позже</option>
            </select>
          </label>
          <label class="field">
            <span>Повтор</span>
            <select name="repeatRule">
              <option value="none" ${task.repeatRule === "none" ? "selected" : ""}>Не повторять</option>
              <option value="daily" ${task.repeatRule === "daily" ? "selected" : ""}>Каждый день</option>
              <option value="weekly" ${task.repeatRule === "weekly" ? "selected" : ""}>Каждую неделю</option>
              <option value="weekdays" ${task.repeatRule === "weekdays" ? "selected" : ""}>По будням</option>
              <option value="monthly" ${task.repeatRule === "monthly" ? "selected" : ""}>Каждый месяц</option>
            </select>
          </label>
        </div>
        <p class="form-error" data-edit-error hidden></p>
        <div class="edit-actions">
          <button class="primary-action" type="submit">Сохранить</button>
          <button type="button" data-action="cancel-edit">Отмена</button>
        </div>
      </form>
    `;
    card.querySelector('input[name="title"]').focus();
  }

  function renderDateActionForm(card, task, mode) {
    const isMove = mode === "move";
    const fieldName = isMove ? "myDayDate" : "dueDate";
    const title = isMove ? "Перенести в другой день" : "Изменить дедлайн";
    const value = task[fieldName] || "";

    card.innerHTML = `
      <form class="date-action-form" data-date-action-form="${mode}">
        <p class="task-group__title">${title}: ${escapeHtml(task.title)}</p>
        <label class="field">
          <span>${isMove ? "День выполнения" : "Новый дедлайн"}</span>
          <input name="${fieldName}" type="date" value="${escapeHtml(value)}" ${isMove ? "required" : ""} />
        </label>
        <p class="form-error" data-date-action-error hidden></p>
        <div class="edit-actions">
          <button class="primary-action" type="submit">Сохранить</button>
          <button type="button" data-action="cancel-date-action">Отмена</button>
        </div>
      </form>
    `;
    card.querySelector("input").focus();
  }

  function handleTaskFormSubmit(event) {
    event.preventDefault();
    const values = collectTaskFormValues(taskForm);
    const error = validateTaskInput(values);

    if (error) {
      showFormError(error);
      return;
    }

    addTask(values);
    hideTaskForm();
  }

  function collectEditValues(form) {
    const values = collectTaskFormValues(form);
    return {
      ...values,
      seriesId: values.repeatRule === "none" ? null : undefined,
    };
  }

  function handleTaskAction(event) {
    const actionButton = event.target.closest("[data-action]");

    if (!actionButton) {
      return;
    }

    const card = event.target.closest("[data-task-id]");

    if (!card) {
      return;
    }

    const taskId = card.dataset.taskId;
    const action = actionButton.dataset.action;

    if (action === "complete") {
      completeTask(taskId);
    } else if (action === "cancel") {
      cancelTask(taskId);
    } else if (action === "edit") {
      const task = findTask(taskId);
      if (task) {
        renderEditForm(card, task);
      }
    } else if (action === "move") {
      const task = findTask(taskId);
      if (task) {
        renderDateActionForm(card, task, "move");
      }
    } else if (action === "change-due") {
      const task = findTask(taskId);
      if (task) {
        renderDateActionForm(card, task, "change-due");
      }
    } else if (action === "delete") {
      deleteTask(taskId);
    } else if (action === "cancel-edit" || action === "cancel-date-action") {
      render();
    }
  }

  function handleWeekToggle(event) {
    const toggle = event.target.closest("[data-week-toggle]");

    if (!toggle) {
      return;
    }

    const date = toggle.dataset.weekToggle;

    if (expandedWeekDays.has(date)) {
      expandedWeekDays.delete(date);
    } else {
      expandedWeekDays.add(date);
    }

    render();
  }

  async function handleEditSubmit(event) {
    const form = event.target.closest("[data-edit-form]");

    if (!form) {
      return;
    }

    event.preventDefault();
    const card = form.closest("[data-task-id]");
    const values = collectEditValues(form);
    const error = validateTaskInput(values);
    const errorNode = form.querySelector("[data-edit-error]");

    if (error) {
      errorNode.textContent = error;
      errorNode.hidden = false;
      return;
    }

    const cleanedValues = Object.fromEntries(Object.entries(values).filter((entry) => entry[1] !== undefined));
    const task = findTask(card.dataset.taskId);

    if (task && task.repeatRule !== "none" && task.seriesId) {
      const scope = await askSeriesScope("Изменить только эту задачу или всю серию?");

      if (scope === "cancel") {
        return;
      }

      if (scope === "series") {
        applySeriesUpdate(task, cleanedValues);
        return;
      }
    }

    updateTask(card.dataset.taskId, cleanedValues);
  }

  function handleDateActionSubmit(event) {
    const form = event.target.closest("[data-date-action-form]");

    if (!form) {
      return;
    }

    event.preventDefault();
    const mode = form.dataset.dateActionForm;
    const card = form.closest("[data-task-id]");
    const fieldName = mode === "move" ? "myDayDate" : "dueDate";
    const values = collectDateFormValues(form, fieldName);
    const errorNode = form.querySelector("[data-date-action-error]");

    if (mode === "move" && !values.myDayDate) {
      errorNode.textContent = "Выберите дату планирования.";
      errorNode.hidden = false;
      return;
    }

    updateTask(card.dataset.taskId, values);
  }

  function moveTaskToDate(taskId, date) {
    const task = findTask(taskId);

    if (!task || task.time) {
      if (task && task.time) {
        updateTask(taskId, { myDayDate: date });
      }
      return;
    }

    updateTask(taskId, {
      myDayDate: date,
      order: getNextOrderForDate(date),
    });
  }

  function reorderUntimedTask(taskId, targetTaskId) {
    const source = findTask(taskId);
    const target = findTask(targetTaskId);

    if (!source || !target || source.id === target.id || source.time || target.time) {
      return;
    }

    source.myDayDate = target.myDayDate;
    source.order = Number(target.order) + 1;
    normalizeUntimedOrder(source.myDayDate);
    source.updatedAt = nowISO();
    saveData();
    render();
  }

  function normalizeUntimedOrder(date) {
    appState.tasks
      .filter((task) => task.status === "active" && !task.time && task.myDayDate === date)
      .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
      .forEach((task, index) => {
        task.order = (index + 1) * 10;
      });
  }

  function handleDragStart(event) {
    const card = event.target.closest("[data-task-id]");

    if (!card) {
      return;
    }

    draggedTaskId = card.dataset.taskId;
    card.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draggedTaskId);
  }

  function handleDragEnd(event) {
    const card = event.target.closest("[data-task-id]");
    if (card) {
      card.classList.remove("is-dragging");
    }
    document.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    draggedTaskId = null;
  }

  function handleDragOver(event) {
    const dropTarget = event.target.closest("[data-drop-date], #todayPanel, #ideasPanel, [data-task-id]");

    if (!dropTarget || !draggedTaskId) {
      return;
    }

    event.preventDefault();
    dropTarget.classList.add("is-drop-target");
  }

  function handleDragLeave(event) {
    const dropTarget = event.target.closest("[data-drop-date], #todayPanel, #ideasPanel, [data-task-id]");
    if (dropTarget) {
      dropTarget.classList.remove("is-drop-target");
    }
  }

  function handleDrop(event) {
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;

    if (!taskId) {
      return;
    }

    const targetCard = event.target.closest("[data-task-id]");
    const dayTarget = event.target.closest("[data-drop-date]");
    const todayTarget = event.target.closest("#todayPanel");
    const ideasTarget = event.target.closest("#ideasPanel");

    event.preventDefault();

    if (targetCard && targetCard.dataset.taskId !== taskId) {
      reorderUntimedTask(taskId, targetCard.dataset.taskId);
    } else if (dayTarget) {
      moveTaskToDate(taskId, dayTarget.dataset.dropDate);
    } else if (todayTarget) {
      moveTaskToDate(taskId, toISODate(new Date()));
    } else if (ideasTarget) {
      updateTask(taskId, { myDayDate: null });
    }

    document.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
  }

  function init() {
    setCurrentDate();
    loadData();
    setTheme(appState.settings.theme);
    render();

    themeToggle.addEventListener("click", function () {
      setTheme(shell.dataset.theme === "dark" ? "light" : "dark", { save: true });
    });

    settingsToggle.addEventListener("click", function () {
      toggleSettings();
    });

    filterToggle.addEventListener("click", function () {
      toggleFilters();
    });

    addTaskButton.addEventListener("click", showTaskForm);
    cancelTaskForm.addEventListener("click", hideTaskForm);
    taskForm.addEventListener("submit", handleTaskFormSubmit);
    resetDataButton.addEventListener("click", resetData);
    clearFinishedButton.addEventListener("click", clearFinishedTasks);
    exportDataButton.addEventListener("click", exportData);
    importDataButton.addEventListener("click", function () {
      importDataInput.click();
    });
    importDataInput.addEventListener("change", function () {
      importData(importDataInput.files[0]);
    });
    undoCompleteButton.addEventListener("click", undoComplete);
    seriesSingleButton.addEventListener("click", function () {
      resolveSeriesScope("single");
    });
    seriesAllButton.addEventListener("click", function () {
      resolveSeriesScope("series");
    });
    seriesCancelButton.addEventListener("click", function () {
      resolveSeriesScope("cancel");
    });

    [...categoryFilterInputs, ...priorityFilterInputs].forEach((input) => {
      input.addEventListener("change", render);
    });

    document.addEventListener("click", function (event) {
      if (!settingsMenu.hidden && !event.target.closest(".settings")) {
        toggleSettings(false);
      }

      handleWeekToggle(event);
      handleTaskAction(event);
    });

    document.addEventListener("submit", function (event) {
      handleEditSubmit(event);
      handleDateActionSubmit(event);
    });

    document.addEventListener("dragstart", handleDragStart);
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("dragleave", handleDragLeave);
    document.addEventListener("drop", handleDrop);

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (!seriesScopeModal.hidden) {
          resolveSeriesScope("cancel");
          return;
        }

        toggleSettings(false);

        if (!taskFormPanel.hidden) {
          hideTaskForm();
        } else if (!filterPanel.hidden) {
          toggleFilters(false);
        } else if (document.querySelector("[data-edit-form]")) {
          render();
        }
      }
    });
  }

  window.PlannerApp = {
    constants: {
      STORAGE_KEY,
      LEGACY_STORAGE_KEY,
      DATA_VERSION,
      FINISHED_TTL_DAYS,
      UNDO_TIMEOUT_MS,
    },
    createInitialData,
    createTask,
    migrateData,
    cleanupFinishedTasks,
    addTask,
    updateTask,
    completeTask,
    createNextRepeatTask,
    ensureUpcomingRepeatTasks,
    ensureUpcomingRepeatsForAll,
    getNextRepeatDate,
    exportData,
    importData,
    undoComplete,
    cancelTask,
    clearFinishedTasks,
    getState: function () {
      return appState;
    },
    resetData,
    render,
  };

  init();
})();
