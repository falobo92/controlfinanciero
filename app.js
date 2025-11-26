/**
 * Dashboard Financiero CRAMSA
 * Lectura de BD CRAMSA.csv y visualización completa
 */

const monthLabels = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

const state = {
    rawData: [],
    filteredData: [],
    years: [],
    months: [],
    currentCC: "all",
    currentYear: "all",
    currentMonth: "all",
    dateFrom: null,
    dateTo: null,
    groupLevels: { tipo: true, item: true, categoria: true },
    paretoThreshold: 0.8,
    charts: {},
    // Estado para Base de Datos
    db: {
        searchTerm: "",
        currentPage: 1,
        pageSize: 50,
        selectedRows: new Set(),
        filteredData: [],
        isEditMode: false, // Toggle para habilitar/deshabilitar edición de celdas
        // Filtros por columna
        filters: {
            tipo: "",
            cc: "",
            item: "",
            categoria: "",
            subcategoria: "",
            detalle: "",
            fechaDesde: null,
            fechaHasta: null,
            montoMin: null,
            montoMax: null
        }
    }
};

// Colores para gráficos
const chartColors = {
    ingresos: { border: "#00c853", bg: "rgba(0, 200, 83, 0.4)" },
    egresos: { border: "#d32f2f", bg: "rgba(211, 47, 47, 0.4)" }
};

document.addEventListener("DOMContentLoaded", () => {
    setupNavTabs();
    setupCCFilters();
    setupDateFilters();
    setupDateRangeFilters();
    setupImportCSV();
    setupClearData();
    setupExpandCollapse();
    setupParetoFilters();
    setupGroupCheckboxes();
    setupDatabaseControls();
    // setupExportPDF(); // Desactivado
    
    // Intentar cargar datos guardados en localStorage
    loadFromLocalStorage();
});

// ===== PERSISTENCIA EN LOCALSTORAGE =====
function saveToLocalStorage() {
    try {
        // Guardar los datos raw (sin las fechas como objetos Date)
        const dataToSave = state.rawData.map(row => ({
            ...row,
            fecha: row.fecha ? row.fecha.toISOString() : null
        }));
        localStorage.setItem("cramsa_data", JSON.stringify(dataToSave));
    } catch (e) {
        console.warn("No se pudo guardar en localStorage:", e);
    }
}

function loadFromLocalStorage() {
    try {
        const savedData = localStorage.getItem("cramsa_data");
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            if (parsedData && parsedData.length > 0) {
                // Restaurar las fechas como objetos Date
                state.rawData = parsedData.map(row => ({
                    ...row,
                    fecha: row.fecha ? new Date(row.fecha) : null
                }));
                
                extractFilterOptions();
                buildDynamicHeaders();
                buildCCButtons();
                applyFilters();
                return;
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar desde localStorage:", e);
    }
    
    // Si no hay datos guardados, mostrar estado vacío
    showEmptyState();
}

function clearLocalStorage() {
    try {
        localStorage.removeItem("cramsa_data");
    } catch (e) {
        console.warn("No se pudo limpiar localStorage:", e);
    }
}

// ===== ESTADO VACÍO =====
function showEmptyState() {
    const summaryHead = document.getElementById("summaryHead");
    const summaryBody = document.getElementById("summaryBody");
    const movementsHead = document.getElementById("movementsHead");
    const movementsBody = document.getElementById("movementsBody");

    if (summaryHead) summaryHead.innerHTML = "";
    if (summaryBody) summaryBody.innerHTML = `<tr><td class="empty-message">Importe un archivo CSV para visualizar los datos</td></tr>`;
    if (movementsHead) movementsHead.innerHTML = "";
    if (movementsBody) movementsBody.innerHTML = `<tr><td class="empty-message">Importe un archivo CSV para visualizar los datos</td></tr>`;

    // Limpiar KPIs
    document.getElementById("kpiSaldoInicial").textContent = "$0";
    document.getElementById("kpiEntradas").textContent = "$0";
    document.getElementById("kpiSalidas").textContent = "$0";
    document.getElementById("kpiFinal").textContent = "$0";

    // Destruir gráficos
    destroyChart("line");
    destroyChart("donut");
    destroyChart("horizontal");
    destroyChart("waterfall");
    destroyChart("pareto");

    // Limpiar tabla Pareto
    const paretoBody = document.getElementById("paretoBody");
    if (paretoBody) paretoBody.innerHTML = `<tr><td colspan="4" class="empty-message">Sin datos</td></tr>`;
}

// ===== CARGA DE DATOS =====
function loadData() {
    // Esta función ya no se llama automáticamente
    // Solo se usa si se quiere cargar un archivo por defecto
}

function processData(data) {
    state.rawData = data.map(normalizeRow).filter(Boolean);
    extractFilterOptions();
    applyFilters();
}

function normalizeRow(row) {
    const tipo = row["Tipo de movimiento"]?.trim();
    if (!tipo) return null;

    // Intentar parsear la fecha en diferentes formatos
    let fecha = null;
    const fechaValue = row.Fecha;
    
    if (fechaValue) {
        // Primero intentar como número serial de Excel
        const serial = Number(fechaValue);
        if (Number.isFinite(serial) && serial > 1000) {
            fecha = excelSerialToDate(serial);
        } else {
            // Intentar como fecha en formato DD/MM/YYYY
            const dateMatch = String(fechaValue).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
            if (dateMatch) {
                const [, day, month, year] = dateMatch;
                fecha = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            } else {
                // Intentar como fecha ISO (YYYY-MM-DD)
                const isoDate = new Date(fechaValue);
                if (!isNaN(isoDate.getTime())) {
                    fecha = isoDate;
                }
            }
        }
    }

    if (!fecha || isNaN(fecha.getTime())) return null;

    const monto = Number(row.Monto) || 0;

    return {
        tipo,
        cc: row["Centro de costos"]?.trim() || "",
        item: row["Item"]?.trim() || "-",
        categoria: row["Categoría"]?.trim() || "Sin categoría",
        subcategoria: row["Subcategoría"]?.trim() || "-",
        detalle: row["Detalle"]?.trim() || "",
        monto,
        fecha,
        year: fecha.getFullYear(),
        month: fecha.getMonth()
    };
}

function excelSerialToDate(serial) {
    // Base Excel: 30/12/1899, pero hay que sumar 1 día para corregir el offset
    const base = Date.UTC(1899, 11, 30);
    // Sumar 1 día (86400000 ms) para corregir el desfase
    return new Date(base + (serial + 1) * 24 * 60 * 60 * 1000);
}

function extractFilterOptions() {
    state.years = [...new Set(state.rawData.map((r) => r.year))].sort();
    state.months = [...new Set(state.rawData.map((r) => r.month))].sort((a, b) => a - b);

    const yearSelect = document.getElementById("filterYear");
    const monthSelect = document.getElementById("filterMonth");

    if (yearSelect) {
        yearSelect.innerHTML = `<option value="all">Todos</option>`;
        state.years.forEach((y) => {
            yearSelect.innerHTML += `<option value="${y}">${y}</option>`;
        });
    }

    if (monthSelect) {
        monthSelect.innerHTML = `<option value="all">Todos</option>`;
        state.months.forEach((m) => {
            monthSelect.innerHTML += `<option value="${m}">${monthLabels[m]}</option>`;
        });
    }
}

function showError(msg) {
    document.getElementById("summaryBody").innerHTML = `<tr><td class="empty-message">${msg}</td></tr>`;
    document.getElementById("movementsBody").innerHTML = `<tr><td class="empty-message">${msg}</td></tr>`;
}

// ===== SETUP EVENTOS =====
function setupNavTabs() {
    const tabs = document.querySelectorAll(".nav-tab");
    const views = {
        resumen: document.getElementById("viewResumen"),
        movimientos: document.getElementById("viewMovimientos"),
        basedatos: document.getElementById("viewBasedatos")
    };
    const filtersBar = document.querySelector(".filters-bar");

    tabs.forEach((tab) => {
        tab.addEventListener("click", () => {
            tabs.forEach((t) => t.classList.remove("active"));
            tab.classList.add("active");

            Object.values(views).forEach((v) => v?.classList.remove("active"));
            const targetView = views[tab.dataset.view];
            if (targetView) targetView.classList.add("active");

            // Ocultar barra de filtros en Base de Datos (tiene sus propios filtros)
            if (filtersBar) {
                filtersBar.style.display = tab.dataset.view === "basedatos" ? "none" : "flex";
            }

            // Si es la vista de base de datos, renderizar
            if (tab.dataset.view === "basedatos") {
                renderDatabaseTable();
            }
        });
    });
}

function setupCCFilters() {
    const buttons = document.querySelectorAll(".cc-btn");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentCC = btn.dataset.cc;
            applyFilters();
        });
    });
}

function setupDateFilters() {
    const yearSelect = document.getElementById("filterYear");
    const monthSelect = document.getElementById("filterMonth");

    yearSelect?.addEventListener("change", () => {
        state.currentYear = yearSelect.value;
        applyFilters();
    });

    monthSelect?.addEventListener("change", () => {
        state.currentMonth = monthSelect.value;
        applyFilters();
    });
}

function setupDateRangeFilters() {
    const dateFrom = document.getElementById("dateFrom");
    const dateTo = document.getElementById("dateTo");
    const btnClear = document.getElementById("btnClearDates");

    dateFrom?.addEventListener("change", () => {
        state.dateFrom = dateFrom.value ? new Date(dateFrom.value + "-01") : null;
        applyFilters();
    });

    dateTo?.addEventListener("change", () => {
        state.dateTo = dateTo.value ? new Date(dateTo.value + "-01") : null;
        // Ajustar al último día del mes
        if (state.dateTo) {
            state.dateTo = new Date(state.dateTo.getFullYear(), state.dateTo.getMonth() + 1, 0);
        }
        applyFilters();
    });

    btnClear?.addEventListener("click", () => {
        dateFrom.value = "";
        dateTo.value = "";
        state.dateFrom = null;
        state.dateTo = null;
        applyFilters();
    });
}

function setupImportCSV() {
    const btnImport = document.getElementById("btnImport");
    const csvInput = document.getElementById("csvInput");

    btnImport?.addEventListener("click", () => csvInput?.click());

    csvInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        // Intentar primero con UTF-8 (formato de exportación)
        Papa.parse(file, {
            header: true,
            delimiter: ";",
            encoding: "UTF-8",
            skipEmptyLines: true,
            complete: ({ data }) => {
                // Verificar si los datos se parsearon correctamente
                const validData = data.filter(row => row["Tipo de movimiento"]?.trim());
                
                if (validData.length === 0) {
                    // Si no hay datos válidos con UTF-8, intentar con ISO-8859-1
                    Papa.parse(file, {
                        header: true,
                        delimiter: ";",
                        encoding: "ISO-8859-1",
                        skipEmptyLines: true,
                        complete: ({ data: dataISO }) => {
                            processImportedData(dataISO);
                        },
                        error: (err) => {
                            console.error("Error al importar CSV", err);
                            alert("Error al importar el archivo CSV.");
                        }
                    });
                } else {
                    processImportedData(data);
                }
            },
            error: (err) => {
                console.error("Error al importar CSV", err);
                alert("Error al importar el archivo CSV.");
            }
        });
        // Reset input para permitir cargar el mismo archivo de nuevo
        csvInput.value = "";
    });
}

function processImportedData(data) {
    // Resetear filtros de Base de Datos antes de cargar nuevos datos
    resetDbFilters();
    
    processData(data);
    buildDynamicHeaders();
    buildCCButtons();
    
    // Guardar en localStorage para persistencia
    saveToLocalStorage();
    
    alert(`CSV importado: ${state.rawData.length} registros cargados.`);
}

function setupClearData() {
    const btnClear = document.getElementById("btnClearData");
    btnClear?.addEventListener("click", () => {
        if (confirm("¿Está seguro de que desea limpiar todos los datos?")) {
            state.rawData = [];
            state.filteredData = [];
            state.years = [];
            state.months = [];
            state.currentCC = "all";
            state.currentYear = "all";
            state.currentMonth = "all";
            state.dateFrom = null;
            state.dateTo = null;

            // Limpiar localStorage
            clearLocalStorage();

            // Limpiar inputs de fecha
            const dateFrom = document.getElementById("dateFrom");
            const dateTo = document.getElementById("dateTo");
            if (dateFrom) dateFrom.value = "";
            if (dateTo) dateTo.value = "";

            // Resetear botones CC
            const ccContainer = document.querySelector(".cc-filters");
            if (ccContainer) {
                ccContainer.innerHTML = `
                    <span class="filter-label">Centro de Costos:</span>
                    <button class="cc-btn active" data-cc="all">Todos</button>
                `;
                setupCCFilters();
            }

            // Resetear selects de filtro
            const yearSelect = document.getElementById("filterYear");
            const monthSelect = document.getElementById("filterMonth");
            if (yearSelect) yearSelect.innerHTML = `<option value="all">Todos</option>`;
            if (monthSelect) monthSelect.innerHTML = `<option value="all">Todos</option>`;

            // Resetear filtros de Base de Datos
            resetDbFilters();

            showEmptyState();
        }
    });
}

function resetDbFilters() {
    state.db = {
        searchTerm: "",
        currentPage: 1,
        pageSize: 50,
        selectedRows: new Set(),
        filteredData: [],
        isEditMode: false,
        filters: {
            tipo: "",
            cc: "",
            item: "",
            categoria: "",
            subcategoria: "",
            detalle: "",
            fechaDesde: null,
            fechaHasta: null,
            montoMin: null,
            montoMax: null
        }
    };

    // Limpiar UI de filtros
    const filterIds = ["dbSearch", "filterDbSubcat", "filterDbDetalle", "filterDbFechaDesde", "filterDbFechaHasta", "filterDbMontoMin", "filterDbMontoMax"];
    filterIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    // Resetear selects de filtro
    ["filterDbTipo", "filterDbCC", "filterDbItem", "filterDbCategoria"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<option value="">Todos</option>`;
    });

    // Resetear checkbox de seleccionar todos
    const selectAll = document.getElementById("dbSelectAll");
    if (selectAll) selectAll.checked = false;

    // Resetear botón de modo edición
    const btnEditMode = document.getElementById("btnEditMode");
    btnEditMode?.classList.remove("active");

    updateBulkEditButton();
}

function buildDynamicHeaders() {
    const columns = getColumns();
    const summaryHead = document.getElementById("summaryHead");
    const movementsHead = document.getElementById("movementsHead");

    // Agrupar columnas por año
    const yearGroups = {};
    columns.forEach((col) => {
        if (!yearGroups[col.year]) yearGroups[col.year] = [];
        yearGroups[col.year].push(col);
    });

    const years = Object.keys(yearGroups).sort();

    // Header para Summary
    if (summaryHead) {
        let yearRow = "<tr><th></th>";
        let monthRow = "<tr><th></th>";

        years.forEach((year, idx) => {
            const count = yearGroups[year].length;
            const altClass = idx > 0 ? " year-alt" : "";
            yearRow += `<th colspan="${count}" class="year-header${altClass}">${year}</th>`;
            yearGroups[year].forEach((col) => {
                monthRow += `<th>${monthLabels[col.month]}</th>`;
            });
        });

        yearRow += "</tr>";
        monthRow += "</tr>";
        summaryHead.innerHTML = yearRow + monthRow;
    }

    // Header para Movements
    if (movementsHead) {
        let headerRow = `<tr>
            <th class="col-expand"></th>
            <th class="col-tipo">Tipo</th>
            <th class="col-item">Item</th>
            <th class="col-categoria">Categoría</th>
            <th class="col-subcategoria">Subcategoría</th>`;

        columns.forEach((col, idx) => {
            const is2026 = col.year > years[0];
            headerRow += `<th class="${is2026 ? "col-2026" : ""}">${monthLabels[col.month]}</th>`;
        });

        headerRow += "</tr>";
        movementsHead.innerHTML = headerRow;
    }
}

function buildCCButtons() {
    const ccContainer = document.querySelector(".cc-filters");
    if (!ccContainer) return;

    // Obtener CCs únicos de los datos
    const uniqueCCs = [...new Set(state.rawData.map((r) => r.cc))].filter(Boolean).sort();

    let html = `<span class="filter-label">Centro de Costos:</span>
                <button class="cc-btn active" data-cc="all">Todos</button>`;

    uniqueCCs.forEach((cc) => {
        html += `<button class="cc-btn" data-cc="${cc}">${cc}</button>`;
    });

    ccContainer.innerHTML = html;
    setupCCFilters();
}

function setupExpandCollapse() {
    document.getElementById("btnExpandAll")?.addEventListener("click", () => {
        document.querySelectorAll(".movements-table tr[data-level]").forEach((row) => {
            row.classList.remove("row-collapsed", "row-hidden");
        });
    });

    document.getElementById("btnCollapseAll")?.addEventListener("click", () => {
        document.querySelectorAll(".movements-table tr[data-level]").forEach((row) => {
            const level = parseInt(row.dataset.level);
            if (level === 0) {
                row.classList.add("row-collapsed");
            } else {
                row.classList.add("row-hidden");
            }
        });
    });
}

function setupParetoFilters() {
    const buttons = document.querySelectorAll(".pareto-btn");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.paretoThreshold = parseFloat(btn.dataset.threshold);
            renderParetoSection();
        });
    });
}

function setupGroupCheckboxes() {
    const checkboxes = {
        tipo: document.getElementById("groupTipo"),
        item: document.getElementById("groupItem"),
        categoria: document.getElementById("groupCategoria")
    };

    Object.entries(checkboxes).forEach(([key, checkbox]) => {
        checkbox?.addEventListener("change", () => {
            state.groupLevels[key] = checkbox.checked;
            renderMovementsTable();
        });
    });
}

// ===== FILTRADO =====
function applyFilters() {
    let data = state.rawData;

    if (state.currentCC !== "all") {
        data = data.filter((r) => r.cc === state.currentCC);
    }

    if (state.currentYear !== "all") {
        data = data.filter((r) => r.year === Number(state.currentYear));
    }

    if (state.currentMonth !== "all") {
        data = data.filter((r) => r.month === Number(state.currentMonth));
    }

    // Filtro por rango de fechas
    if (state.dateFrom) {
        data = data.filter((r) => r.fecha >= state.dateFrom);
    }

    if (state.dateTo) {
        data = data.filter((r) => r.fecha <= state.dateTo);
    }

    state.filteredData = data;

    // Render all views
    renderSummaryTable();
    renderMovementsTable();
    renderDashboard();
}

// ===== COLUMNAS DE MESES (Mar 2025 - Dic 2026) =====
function getColumns() {
    const cols = [];
    // 2025: Mar - Dic (meses 2-11)
    for (let m = 2; m <= 11; m++) {
        cols.push({ year: 2025, month: m });
    }
    // 2026: Ene - Dic (meses 0-11)
    for (let m = 0; m <= 11; m++) {
        cols.push({ year: 2026, month: m });
    }
    return cols;
}

// ===== SUMMARY TABLE =====
function renderSummaryTable() {
    const tbody = document.getElementById("summaryBody");
    if (!tbody) return;

    const columns = getColumns();
    
    // Datos
    const ingresos = columns.map((col) => sumByType("01_Ingreso", col.year, col.month));
    const cargos = columns.map((col) => sumByType("02_Cargo", col.year, col.month));
    const saldosIniciales = columns.map((col) => sumByType("03_Saldos iniciales", col.year, col.month));
    const movInternos = columns.map((col) => sumByType("04_Movimiento Interno", col.year, col.month));
    
    // Calcular saldo del mes
    const saldoMes = [];
    const saldoAcumulado = [];
    
    const saldoInicialTotal = saldosIniciales.reduce((acc, v) => acc + v, 0);
    let acumulado = saldoInicialTotal;
    
    for (let i = 0; i < columns.length; i++) {
        let saldoDelMes;
        if (state.currentCC === "all") {
            saldoDelMes = ingresos[i] + cargos[i];
        } else {
            saldoDelMes = ingresos[i] + cargos[i] + movInternos[i];
        }
        saldoMes.push(saldoDelMes);
        acumulado += saldoDelMes;
        saldoAcumulado.push(acumulado);
    }

    // Mostrar movimientos internos solo si no es vista "Todos"
    const movInternosRow = state.currentCC !== "all" ? `
        <tr class="row-mov-interno">
            <td>04_Mov. Interno</td>
            ${movInternos.map((v) => `<td class="${v < 0 ? "val-negative" : v > 0 ? "val-positive" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
    ` : "";

    tbody.innerHTML = `
        <tr class="row-ingreso">
            <td>01_Ingreso</td>
            ${ingresos.map((v) => `<td class="${v < 0 ? "val-negative" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-cargo">
            <td>02_Cargo</td>
            ${cargos.map((v) => `<td class="${v < 0 ? "val-negative" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-saldo-inicial">
            <td>03_Saldo inicial</td>
            ${saldosIniciales.map((v) => `<td class="${v < 0 ? "val-negative" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
        ${movInternosRow}
        <tr class="row-saldo-mes">
            <td>Saldo del Mes</td>
            ${saldoMes.map((v) => `<td class="${v < 0 ? "val-negative" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-saldo-acum">
            <td>Saldo Acumulado</td>
            ${saldoAcumulado.map((v) => `<td class="${v < 0 ? "val-negative" : ""}">${formatNumber(v)}</td>`).join("")}
        </tr>
    `;
}

function sumByType(tipo, year, month) {
    return state.filteredData
        .filter((r) => r.tipo === tipo && r.year === year && r.month === month)
        .reduce((acc, r) => acc + r.monto, 0);
}

// ===== MOVEMENTS TABLE (AGRUPACIÓN MULTINIVEL) =====
function renderMovementsTable() {
    const tbody = document.getElementById("movementsBody");
    if (!tbody) return;

    const columns = getColumns();
    const data = state.filteredData;

    if (!data.length) {
        tbody.innerHTML = `<tr><td colspan="27">Sin datos para los filtros seleccionados</td></tr>`;
        return;
    }

    const { tipo: groupTipo, item: groupItem, categoria: groupCategoria } = state.groupLevels;
    
    // Construir estructura jerárquica
    const hierarchy = buildHierarchy(data, groupTipo, groupItem, groupCategoria);
    
    let html = "";
    let rowId = 0;

    hierarchy.forEach((tipoGroup) => {
        const tipoId = `row-${rowId++}`;
        const isEgreso = tipoGroup.label.includes("02_Cargo");
        
        if (groupTipo) {
            // Fila nivel 0 (Tipo)
            html += createHierarchyRow(tipoId, null, 0, tipoGroup.label, "", "", "", tipoGroup.totals, columns, tipoGroup.hasChildren, false);
        }

        tipoGroup.children.forEach((itemGroup) => {
            const itemId = `row-${rowId++}`;
            const itemParent = groupTipo ? tipoId : null;
            const itemLevel = groupTipo ? 1 : 0;

            if (groupItem) {
                // Fila nivel 1 (Item)
                html += createHierarchyRow(itemId, itemParent, itemLevel, groupTipo ? "" : tipoGroup.label, itemGroup.label, "", "", itemGroup.totals, columns, itemGroup.hasChildren, false);
            }

            itemGroup.children.forEach((catGroup) => {
                const catId = `row-${rowId++}`;
                const catParent = groupItem ? itemId : (groupTipo ? tipoId : null);
                let catLevel = 0;
                if (groupTipo) catLevel++;
                if (groupItem) catLevel++;

                if (groupCategoria) {
                    // Fila nivel 2 (Categoría) - Pasar isEgreso para colorear rojo
                    html += createHierarchyRow(catId, catParent, catLevel, 
                        (!groupTipo && !groupItem) ? tipoGroup.label : "", 
                        (!groupItem) ? itemGroup.label : "", 
                        catGroup.label, "", catGroup.totals, columns, catGroup.hasChildren, isEgreso);
                }

                catGroup.children.forEach((subcat) => {
                    const subcatParent = groupCategoria ? catId : (groupItem ? itemId : (groupTipo ? tipoId : null));
                    let subcatLevel = 0;
                    if (groupTipo) subcatLevel++;
                    if (groupItem) subcatLevel++;
                    if (groupCategoria) subcatLevel++;

                    // Fila nivel 3 (Subcategoría - detalle)
                    html += createHierarchyRow(`row-${rowId++}`, subcatParent, subcatLevel,
                        (!groupTipo) ? tipoGroup.label : "",
                        (!groupItem) ? itemGroup.label : "",
                        (!groupCategoria) ? catGroup.label : "",
                        subcat.label, subcat.totals, columns, false, false);
                });
            });
        });
    });

    tbody.innerHTML = html;
    setupRowExpanders();
}

function buildHierarchy(data, groupTipo, groupItem, groupCategoria) {
    const columns = getColumns();
    
    // Agrupar por Tipo
    const tipoMap = new Map();
    data.forEach((row) => {
        if (!tipoMap.has(row.tipo)) {
            tipoMap.set(row.tipo, []);
        }
        tipoMap.get(row.tipo).push(row);
    });

    const result = [];

    // Ordenar tipos ascendente
    const sortedTipos = Array.from(tipoMap.keys()).sort((a, b) => a.localeCompare(b));

    sortedTipos.forEach((tipoKey) => {
        const tipoRows = tipoMap.get(tipoKey);
        const tipoTotals = calcTotals(tipoRows, columns);
        
        // Agrupar por Item
        const itemMap = new Map();
        tipoRows.forEach((row) => {
            if (!itemMap.has(row.item)) {
                itemMap.set(row.item, []);
            }
            itemMap.get(row.item).push(row);
        });

        const itemChildren = [];
        // Ordenar items ascendente
        const sortedItems = Array.from(itemMap.keys()).sort((a, b) => a.localeCompare(b));
        
        sortedItems.forEach((itemKey) => {
            const itemRows = itemMap.get(itemKey);
            const itemTotals = calcTotals(itemRows, columns);

            // Agrupar por Categoría
            const catMap = new Map();
            itemRows.forEach((row) => {
                if (!catMap.has(row.categoria)) {
                    catMap.set(row.categoria, []);
                }
                catMap.get(row.categoria).push(row);
            });

            const catChildren = [];
            // Ordenar categorías ascendente
            const sortedCats = Array.from(catMap.keys()).sort((a, b) => a.localeCompare(b));
            
            sortedCats.forEach((catKey) => {
                const catRows = catMap.get(catKey);
                const catTotals = calcTotals(catRows, columns);

                // Agrupar por Subcategoría
                const subcatMap = new Map();
                catRows.forEach((row) => {
                    if (!subcatMap.has(row.subcategoria)) {
                        subcatMap.set(row.subcategoria, []);
                    }
                    subcatMap.get(row.subcategoria).push(row);
                });

                const subcatChildren = [];
                // Ordenar subcategorías ascendente
                const sortedSubcats = Array.from(subcatMap.keys()).sort((a, b) => a.localeCompare(b));
                
                sortedSubcats.forEach((subcatKey) => {
                    const subcatRows = subcatMap.get(subcatKey);
                    const subcatTotals = calcTotals(subcatRows, columns);
                    subcatChildren.push({
                        label: subcatKey,
                        totals: subcatTotals,
                        hasChildren: false
                    });
                });

                catChildren.push({
                    label: catKey,
                    totals: catTotals,
                    children: subcatChildren,
                    hasChildren: subcatChildren.length > 0
                });
            });

            itemChildren.push({
                label: itemKey,
                totals: itemTotals,
                children: catChildren,
                hasChildren: catChildren.length > 0
            });
        });

        result.push({
            label: tipoKey,
            totals: tipoTotals,
            children: itemChildren,
            hasChildren: itemChildren.length > 0
        });
    });

    return result;
}

function calcTotals(rows, columns) {
    return columns.map((col) => {
        return rows
            .filter((r) => r.year === col.year && r.month === col.month)
            .reduce((acc, r) => acc + r.monto, 0);
    });
}

function createHierarchyRow(id, parentId, level, tipo, item, categoria, subcategoria, totals, columns, hasChildren, isEgreso = false) {
    const parentAttr = parentId ? `data-parent="${parentId}"` : "";
    // Por defecto: niveles 0 y 1 visibles, niveles 2 y 3 ocultos
    const hiddenClass = level >= 2 ? "row-hidden" : "";
    // Nivel 1 empieza colapsado (sus hijos nivel 2 están ocultos)
    const collapsedClass = (level === 1 && hasChildren) ? "row-collapsed" : "";
    const expandIcon = hasChildren ? `<span class="expand-icon">▾</span>` : "";
    const egresoClass = (level === 2 && isEgreso) ? "row-egreso" : "";

    return `
        <tr class="row-level-${level} ${egresoClass} ${hiddenClass} ${collapsedClass}" data-id="${id}" data-level="${level}" ${parentAttr}>
            <td class="col-expand">${expandIcon}</td>
            <td class="col-tipo">${tipo}</td>
            <td class="col-item">${item}</td>
            <td class="col-categoria">${categoria}</td>
            <td class="col-subcategoria">${subcategoria}</td>
            ${totals.map((v, idx) => {
                const isNeg = v < 0;
                const is2026 = idx >= 10;
                return `<td class="col-value ${isNeg ? "val-negative" : ""} ${is2026 ? "col-2026" : ""}">${v !== 0 ? formatNumber(v) : ""}</td>`;
            }).join("")}
        </tr>
    `;
}

function setupRowExpanders() {
    const tbody = document.getElementById("movementsBody");
    if (!tbody) return;

    // Remove old listeners by cloning
    const newTbody = tbody.cloneNode(true);
    tbody.parentNode.replaceChild(newTbody, tbody);

    newTbody.addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-level]");
        if (!row) return;

        const expandIcon = row.querySelector(".expand-icon");
        if (!expandIcon) return;

        const rowId = row.dataset.id;
        const isCollapsed = row.classList.toggle("row-collapsed");

        // Toggle direct children and their descendants
        toggleChildren(rowId, isCollapsed);
    });
}

function toggleChildren(parentId, hide) {
    document.querySelectorAll(`tr[data-parent="${parentId}"]`).forEach((child) => {
        child.classList.toggle("row-hidden", hide);
        if (hide) {
            child.classList.add("row-collapsed");
            toggleChildren(child.dataset.id, true);
        }
    });
}

// ===== DASHBOARD =====
function renderDashboard() {
    renderKPIs();
    renderLineChart();
    renderDonutChart();
    renderHorizontalChart();
    renderWaterfallChart();
    renderParetoSection();
}

function renderKPIs() {
    const data = state.filteredData;
    const saldoInicial = data.filter((r) => r.tipo === "03_Saldos iniciales").reduce((acc, r) => acc + r.monto, 0);
    const ingresos = data.filter((r) => r.tipo === "01_Ingreso").reduce((acc, r) => acc + r.monto, 0);
    const egresos = data.filter((r) => r.tipo === "02_Cargo").reduce((acc, r) => acc + Math.abs(r.monto), 0);
    const saldoFinal = saldoInicial + ingresos - egresos;

    document.getElementById("kpiSaldoInicial").textContent = formatCurrency(saldoInicial);
    document.getElementById("kpiEntradas").textContent = formatCurrency(ingresos);
    document.getElementById("kpiSalidas").textContent = formatCurrency(-egresos);
    document.getElementById("kpiFinal").textContent = formatCurrency(saldoFinal);
}

function renderLineChart() {
    const ctx = document.getElementById("lineChart");
    if (!ctx) return;
    destroyChart("line");

    const columns = getColumns();
    
    // Datos
    const ingresos = columns.map((col) => sumByType("01_Ingreso", col.year, col.month));
    const egresos = columns.map((col) => Math.abs(sumByType("02_Cargo", col.year, col.month)));

    // Crear gradientes
    const ctxCanvas = ctx.getContext('2d');
    const gradientGreen = ctxCanvas.createLinearGradient(0, 0, 0, 300);
    gradientGreen.addColorStop(0, 'rgba(0, 200, 83, 0.4)');
    gradientGreen.addColorStop(1, 'rgba(0, 200, 83, 0.02)');

    const gradientRed = ctxCanvas.createLinearGradient(0, 0, 0, 300);
    gradientRed.addColorStop(0, 'rgba(211, 47, 47, 0.4)');
    gradientRed.addColorStop(1, 'rgba(211, 47, 47, 0.02)');

    const datasets = [
        {
            label: "Ingresos",
            data: ingresos,
            borderColor: "#00c853",
            backgroundColor: gradientGreen,
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: "#00c853",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 7,
            pointHoverBackgroundColor: "#00c853",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 3
        },
        {
            label: "Egresos",
            data: egresos,
            borderColor: "#d32f2f",
            backgroundColor: gradientRed,
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 4,
            pointBackgroundColor: "#d32f2f",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 7,
            pointHoverBackgroundColor: "#d32f2f",
            pointHoverBorderColor: "#fff",
            pointHoverBorderWidth: 3
        }
    ];

    state.charts.line = new Chart(ctx, {
        type: "line",
        data: {
            labels: columns.map((c) => `${monthLabels[c.month]} ${String(c.year).slice(-2)}`),
            datasets
        },
        options: {
            responsive: true,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: { weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 43, 60, 0.95)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    stacked: false,
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: (v) => formatAxis(v), font: { size: 11 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 }, maxRotation: 45 }
                }
            }
        }
    });

    const badge = document.getElementById("lineChartBadge");
    if (badge) badge.textContent = state.currentYear !== "all" ? state.currentYear : "2025-2026";
}

function renderDonutChart() {
    const ctx = document.getElementById("donutChart");
    if (!ctx) return;
    destroyChart("donut");

    const incomes = state.filteredData.filter((r) => r.tipo === "01_Ingreso");
    const grouped = groupByCategory(incomes);

    const colors = [
        '#003978', '#0066cc', '#00bcd4', '#00c853', 
        '#ff9800', '#e91e63', '#9c27b0', '#795548',
        '#607d8b', '#f44336'
    ];

    state.charts.donut = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: grouped.map((g) => g.label),
            datasets: [{
                data: grouped.map((g) => g.value),
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverBorderWidth: 4,
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            animation: false,
            cutout: '60%',
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 11, weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 43, 60, 0.95)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${ctx.label}: ${formatCurrency(ctx.raw)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderHorizontalChart() {
    const ctx = document.getElementById("horizontalChart");
    if (!ctx) return;
    destroyChart("horizontal");

    const cargos = state.filteredData.filter((r) => r.tipo === "02_Cargo");
    const grouped = groupByCategory(cargos).slice(0, 8);

    // Crear gradiente para cada barra
    const ctxCanvas = ctx.getContext('2d');
    const gradientRed = ctxCanvas.createLinearGradient(0, 0, 400, 0);
    gradientRed.addColorStop(0, '#d32f2f');
    gradientRed.addColorStop(1, '#ff5252');

    state.charts.horizontal = new Chart(ctx, {
        type: "bar",
        data: {
            labels: grouped.map((g) => g.label.length > 20 ? g.label.slice(0, 18) + '...' : g.label),
            datasets: [{
                data: grouped.map((g) => g.value),
                backgroundColor: gradientRed,
                borderRadius: 6,
                borderSkipped: false,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(26, 43, 60, 0.95)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        title: (items) => grouped[items[0].dataIndex].label,
                        label: (ctx) => `Gasto: ${formatCurrency(-ctx.raw)}`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: (v) => formatAxis(v), font: { size: 11 } }
                },
                y: {
                    grid: { display: false },
                    ticks: { font: { size: 11 } }
                }
            }
        }
    });
}

function renderWaterfallChart() {
    const ctx = document.getElementById("waterfallChart");
    if (!ctx) return;
    destroyChart("waterfall");

    const columns = getColumns();
    
    // Flujo neto
    const netSeries = columns.map((col) => {
        const ing = sumByType("01_Ingreso", col.year, col.month);
        const egr = sumByType("02_Cargo", col.year, col.month);
        return ing + egr;
    });

    let cumulative = 0;
    const cumulativeData = netSeries.map((v) => {
        cumulative += v;
        return cumulative;
    });

    const datasets = [
        {
            type: "line",
            label: "Saldo Acumulado",
            data: cumulativeData,
            borderColor: "#0097a7",
            backgroundColor: "rgba(0, 151, 167, 0.1)",
            borderWidth: 4,
            fill: false,
            tension: 0.3,
            order: 0,
            pointRadius: 5,
            pointBackgroundColor: "#0097a7",
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 8,
            pointHoverBorderWidth: 3
        },
        {
            type: "bar",
            label: "Flujo Mensual",
            data: netSeries,
            backgroundColor: netSeries.map((v) => v >= 0 ? "rgba(0, 200, 83, 0.85)" : "rgba(211, 47, 47, 0.85)"),
            borderColor: netSeries.map((v) => v >= 0 ? "#00c853" : "#d32f2f"),
            borderWidth: 2,
            borderRadius: 6,
            order: 1
        }
    ];

    state.charts.waterfall = new Chart(ctx, {
        data: {
            labels: columns.map((c) => `${monthLabels[c.month]} ${String(c.year).slice(-2)}`),
            datasets
        },
        options: {
            responsive: true,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        font: { weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 43, 60, 0.95)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: (v) => formatAxis(v), font: { size: 11 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: { size: 10 }, maxRotation: 45 }
                }
            }
        }
    });
}

function renderParetoSection() {
    const tbody = document.getElementById("paretoBody");
    const ctx = document.getElementById("paretoChart");
    if (!tbody || !ctx) return;

    const cargos = state.filteredData.filter((r) => r.tipo === "02_Cargo");
    const grouped = groupByCategory(cargos);
    const total = grouped.reduce((acc, g) => acc + g.value, 0);

    if (!grouped.length || total === 0) {
        tbody.innerHTML = `<tr><td colspan="4">Sin datos</td></tr>`;
        destroyChart("pareto");
        return;
    }

    const threshold = total * state.paretoThreshold;
    let running = 0;
    const limited = [];
    for (const item of grouped) {
        if (running < threshold) limited.push(item);
        running += item.value;
    }

    tbody.innerHTML = "";
    running = 0;
    limited.forEach((item, idx) => {
        running += item.value;
        const pct = ((running / total) * 100).toFixed(1);
        tbody.innerHTML += `
            <tr>
                <td style="font-weight: 600; color: #003978;">${idx + 1}</td>
                <td>${item.label}</td>
                <td style="color: #d32f2f; font-weight: 500;">${formatCurrency(-item.value)}</td>
                <td style="color: #0097a7; font-weight: 600;">${pct}%</td>
            </tr>
        `;
    });

    // Chart
    destroyChart("pareto");
    running = 0;
    const cumPercent = grouped.map((g) => {
        running += g.value;
        return (running / total) * 100;
    });

    // Gradiente para barras
    const ctxCanvas = ctx.getContext('2d');
    const gradientBar = ctxCanvas.createLinearGradient(0, 0, 0, 300);
    gradientBar.addColorStop(0, 'rgba(211, 47, 47, 0.9)');
    gradientBar.addColorStop(1, 'rgba(211, 47, 47, 0.5)');

    state.charts.pareto = new Chart(ctx, {
        data: {
            labels: grouped.map((g) => g.label.length > 15 ? g.label.slice(0, 13) + '...' : g.label),
            datasets: [
                {
                    type: "line",
                    label: "% Acumulado",
                    data: cumPercent,
                    yAxisID: "y1",
                    borderColor: "#0097a7",
                    backgroundColor: "rgba(0, 151, 167, 0.1)",
                    borderWidth: 4,
                    fill: false,
                    order: 0,
                    pointRadius: 5,
                    pointBackgroundColor: "#0097a7",
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    pointHoverRadius: 8
                },
                {
                    type: "bar",
                    label: "Gasto por Categoría",
                    data: grouped.map((g) => g.value),
                    backgroundColor: gradientBar,
                    borderColor: "#d32f2f",
                    borderWidth: 1,
                    borderRadius: 4,
                    order: 1
                }
            ]
        },
        options: {
            responsive: true,
            animation: false,
            interaction: {
                intersect: false,
                mode: 'index'
            },
            plugins: {
                legend: {
                    position: "top",
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { weight: '500' }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(26, 43, 60, 0.95)',
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        title: (items) => grouped[items[0].dataIndex]?.label || '',
                        label: (ctx) => {
                            if (ctx.dataset.type === 'line') {
                                return `Acumulado: ${ctx.raw.toFixed(1)}%`;
                            }
                            return `Gasto: ${formatCurrency(-ctx.raw)}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    grid: { color: 'rgba(0,0,0,0.05)' },
                    ticks: { callback: (v) => formatAxis(v), font: { size: 11 } }
                },
                y1: {
                    position: "right",
                    grid: { drawOnChartArea: false },
                    ticks: { callback: (v) => `${v}%`, font: { size: 11 } },
                    max: 100
                },
                x: {
                    grid: { display: false },
                    ticks: { 
                        font: { size: 9 }, 
                        maxRotation: 90,
                        minRotation: 45,
                        autoSkip: false
                    }
                }
            }
        }
    });
}

// ===== HELPERS =====
function groupByCategory(rows) {
    const map = new Map();
    rows.forEach((r) => {
        if (!map.has(r.categoria)) map.set(r.categoria, 0);
        map.set(r.categoria, map.get(r.categoria) + Math.abs(r.monto));
    });
    return Array.from(map.entries())
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value);
}

function destroyChart(name) {
    if (state.charts[name]) {
        state.charts[name].destroy();
        delete state.charts[name];
    }
}

function formatNumber(value) {
    if (value === 0) return "";
    const formatted = Math.abs(value).toLocaleString("es-CL", { maximumFractionDigits: 0 });
    return value < 0 ? `(${formatted})` : formatted;
}

function formatCurrency(value) {
    return new Intl.NumberFormat("es-CL", {
        style: "currency",
        currency: "CLP",
        maximumFractionDigits: 0
    }).format(value);
}

function formatAxis(value) {
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)} MM`;  // Mil millones
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)} M`;   // Millones
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)} K`;   // Miles
    return value;
}

// ===== BASE DE DATOS =====
function setupDatabaseControls() {
    // Búsqueda global
    const searchInput = document.getElementById("dbSearch");
    searchInput?.addEventListener("input", debounce(() => {
        state.db.searchTerm = searchInput.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    // Filtros por columna (selects)
    document.getElementById("filterDbTipo")?.addEventListener("change", (e) => {
        state.db.filters.tipo = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbCC")?.addEventListener("change", (e) => {
        state.db.filters.cc = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbItem")?.addEventListener("change", (e) => {
        state.db.filters.item = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbCategoria")?.addEventListener("change", (e) => {
        state.db.filters.categoria = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    // Filtros por columna (texto)
    document.getElementById("filterDbSubcat")?.addEventListener("input", debounce((e) => {
        state.db.filters.subcategoria = e.target.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbDetalle")?.addEventListener("input", debounce((e) => {
        state.db.filters.detalle = e.target.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    // Filtros de fecha
    document.getElementById("filterDbFechaDesde")?.addEventListener("change", (e) => {
        state.db.filters.fechaDesde = e.target.value ? new Date(e.target.value) : null;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbFechaHasta")?.addEventListener("change", (e) => {
        state.db.filters.fechaHasta = e.target.value ? new Date(e.target.value) : null;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    // Filtros de monto
    document.getElementById("filterDbMontoMin")?.addEventListener("input", debounce((e) => {
        state.db.filters.montoMin = e.target.value ? parseFloat(e.target.value) : null;
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbMontoMax")?.addEventListener("input", debounce((e) => {
        state.db.filters.montoMax = e.target.value ? parseFloat(e.target.value) : null;
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    // Limpiar filtros
    document.getElementById("btnClearDbFilters")?.addEventListener("click", clearDbFilters);

    // Paginación
    document.getElementById("dbPrevPage")?.addEventListener("click", () => {
        if (state.db.currentPage > 1) {
            state.db.currentPage--;
            renderDatabaseTable();
        }
    });

    document.getElementById("dbNextPage")?.addEventListener("click", () => {
        const totalPages = getTotalPages();
        if (state.db.currentPage < totalPages) {
            state.db.currentPage++;
            renderDatabaseTable();
        }
    });

    document.getElementById("dbPageSize")?.addEventListener("change", (e) => {
        state.db.pageSize = e.target.value === "all" ? "all" : parseInt(e.target.value);
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    // Seleccionar todos
    document.getElementById("dbSelectAll")?.addEventListener("change", (e) => {
        const checkboxes = document.querySelectorAll("#dbBody input[type='checkbox']");
        checkboxes.forEach((cb) => {
            cb.checked = e.target.checked;
            const idx = parseInt(cb.dataset.index);
            if (e.target.checked) {
                state.db.selectedRows.add(idx);
            } else {
                state.db.selectedRows.delete(idx);
            }
        });
        updateDbStats();
        updateBulkEditButton();
    });

    // Exportar CSV
    document.getElementById("btnExportCSV")?.addEventListener("click", exportToCSV);

    // Botón modo edición
    document.getElementById("btnEditMode")?.addEventListener("click", toggleEditMode);

    // Nuevo registro
    document.getElementById("btnNewRecord")?.addEventListener("click", openNewRecordModal);

    // Modal individual
    document.getElementById("modalClose")?.addEventListener("click", closeModal);
    document.getElementById("modalCancel")?.addEventListener("click", closeModal);
    document.getElementById("modalSave")?.addEventListener("click", saveEditedRow);

    // Cerrar modal al hacer click fuera
    document.getElementById("editModal")?.addEventListener("click", (e) => {
        if (e.target.id === "editModal") closeModal();
    });

    // Edición masiva
    document.getElementById("btnBulkEdit")?.addEventListener("click", openBulkEditModal);
    document.getElementById("bulkModalClose")?.addEventListener("click", closeBulkModal);
    document.getElementById("bulkModalCancel")?.addEventListener("click", closeBulkModal);
    document.getElementById("bulkModalSave")?.addEventListener("click", saveBulkEdit);

    document.getElementById("bulkEditModal")?.addEventListener("click", (e) => {
        if (e.target.id === "bulkEditModal") closeBulkModal();
    });

    // Checkboxes de edición masiva
    setupBulkCheckboxes();
}

function setupBulkCheckboxes() {
    const fields = ["Tipo", "CC", "Item", "Categoria", "Subcategoria"];
    fields.forEach((field) => {
        const checkbox = document.getElementById(`bulkCheck${field}`);
        const input = document.getElementById(`bulk${field}`);
        checkbox?.addEventListener("change", () => {
            if (input) input.disabled = !checkbox.checked;
        });
    });
}

function toggleEditMode() {
    state.db.isEditMode = !state.db.isEditMode;
    const btn = document.getElementById("btnEditMode");
    const table = document.getElementById("dbTable");
    
    if (state.db.isEditMode) {
        btn?.classList.add("active");
        table?.classList.remove("readonly-mode");
        table?.classList.add("edit-mode");
    } else {
        btn?.classList.remove("active");
        table?.classList.remove("edit-mode");
        table?.classList.add("readonly-mode");
    }
}

function clearDbFilters() {
    // Reset state
    state.db.filters = {
        tipo: "",
        cc: "",
        item: "",
        categoria: "",
        subcategoria: "",
        detalle: "",
        fechaDesde: null,
        fechaHasta: null,
        montoMin: null,
        montoMax: null
    };
    state.db.searchTerm = "";
    state.db.currentPage = 1;

    // Reset UI
    document.getElementById("dbSearch").value = "";
    document.getElementById("filterDbTipo").value = "";
    document.getElementById("filterDbCC").value = "";
    document.getElementById("filterDbItem").value = "";
    document.getElementById("filterDbCategoria").value = "";
    document.getElementById("filterDbSubcat").value = "";
    document.getElementById("filterDbDetalle").value = "";
    document.getElementById("filterDbFechaDesde").value = "";
    document.getElementById("filterDbFechaHasta").value = "";
    document.getElementById("filterDbMontoMin").value = "";
    document.getElementById("filterDbMontoMax").value = "";

    renderDatabaseTable();
}

function updateBulkEditButton() {
    const btn = document.getElementById("btnBulkEdit");
    if (btn) {
        btn.disabled = state.db.selectedRows.size === 0;
    }
}

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

function renderDatabaseTable() {
    const tbody = document.getElementById("dbBody");
    if (!tbody) return;

    if (!state.rawData.length) {
        tbody.innerHTML = `<tr><td colspan="9" class="empty-message">Importe un archivo CSV para visualizar los datos</td></tr>`;
        updateDbStats();
        return;
    }

    // Poblar filtros de columna con opciones únicas
    populateDbFilterOptions();

    // Aplicar todos los filtros
    let filtered = state.rawData;

    // Búsqueda global
    if (state.db.searchTerm) {
        filtered = filtered.filter((row) => {
            const searchStr = `${row.tipo} ${row.cc} ${row.item} ${row.categoria} ${row.subcategoria} ${row.detalle}`.toLowerCase();
            return searchStr.includes(state.db.searchTerm);
        });
    }

    // Filtros por columna
    const f = state.db.filters;
    if (f.tipo) filtered = filtered.filter((r) => r.tipo === f.tipo);
    if (f.cc) filtered = filtered.filter((r) => r.cc === f.cc);
    if (f.item) filtered = filtered.filter((r) => r.item === f.item);
    if (f.categoria) filtered = filtered.filter((r) => r.categoria === f.categoria);
    if (f.subcategoria) filtered = filtered.filter((r) => (r.subcategoria || "").toLowerCase().includes(f.subcategoria));
    if (f.detalle) filtered = filtered.filter((r) => (r.detalle || "").toLowerCase().includes(f.detalle));
    if (f.fechaDesde) filtered = filtered.filter((r) => r.fecha >= f.fechaDesde);
    if (f.fechaHasta) filtered = filtered.filter((r) => r.fecha <= f.fechaHasta);
    if (f.montoMin !== null) filtered = filtered.filter((r) => r.monto >= f.montoMin);
    if (f.montoMax !== null) filtered = filtered.filter((r) => r.monto <= f.montoMax);

    state.db.filteredData = filtered;

    // Paginación
    const pageSize = state.db.pageSize === "all" ? filtered.length : state.db.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.db.currentPage = Math.min(state.db.currentPage, totalPages);

    const startIdx = (state.db.currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageData = filtered.slice(startIdx, endIdx);

    // Aplicar clase de modo edición a la tabla
    const table = document.getElementById("dbTable");
    if (state.db.isEditMode) {
        table?.classList.remove("readonly-mode");
        table?.classList.add("edit-mode");
    } else {
        table?.classList.remove("edit-mode");
        table?.classList.add("readonly-mode");
    }

    // Renderizar filas con celdas editables
    let html = "";
    pageData.forEach((row) => {
        const globalIdx = state.rawData.indexOf(row);
        const isSelected = state.db.selectedRows.has(globalIdx);
        const fechaStr = row.fecha ? row.fecha.toISOString().split("T")[0] : "";
        const fechaDisplay = row.fecha ? row.fecha.toLocaleDateString("es-CL") : "-";
        const montoClass = row.monto < 0 ? "val-negative" : row.monto > 0 ? "val-positive" : "";

        html += `
            <tr class="${isSelected ? "selected" : ""}" data-index="${globalIdx}">
                <td class="col-check">
                    <input type="checkbox" data-index="${globalIdx}" ${isSelected ? "checked" : ""}>
                </td>
                <td data-editable="true" data-field="tipo" data-type="text">${row.tipo || "-"}</td>
                <td data-editable="true" data-field="cc" data-type="text">${row.cc || "-"}</td>
                <td data-editable="true" data-field="item" data-type="text">${row.item || "-"}</td>
                <td data-editable="true" data-field="categoria" data-type="text">${row.categoria || "-"}</td>
                <td data-editable="true" data-field="subcategoria" data-type="text">${row.subcategoria || "-"}</td>
                <td data-editable="true" data-field="detalle" data-type="text" title="${row.detalle || ""}">${truncateText(row.detalle, 30) || "-"}</td>
                <td data-editable="true" data-field="fecha" data-type="date" data-value="${fechaStr}">${fechaDisplay}</td>
                <td data-editable="true" data-field="monto" data-type="number" class="${montoClass}">${formatCurrency(row.monto)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html || `<tr><td colspan="9" class="empty-message">No se encontraron resultados</td></tr>`;

    // Setup event listeners para checkboxes y click en filas
    tbody.querySelectorAll("tr[data-index]").forEach((tr) => {
        const checkbox = tr.querySelector("input[type='checkbox']");
        
        // Click en checkbox
        checkbox?.addEventListener("change", (e) => {
            e.stopPropagation();
            const idx = parseInt(e.target.dataset.index);
            if (e.target.checked) {
                state.db.selectedRows.add(idx);
                tr.classList.add("selected");
            } else {
                state.db.selectedRows.delete(idx);
                tr.classList.remove("selected");
            }
            updateDbStats();
            updateBulkEditButton();
        });

        // Click en celda editable para edición inline (solo si modo edición está activo)
        tr.querySelectorAll("td[data-editable='true']").forEach((td) => {
            td.addEventListener("click", (e) => {
                e.stopPropagation();
                if (state.db.isEditMode) {
                    startInlineEdit(td, tr);
                }
            });
        });

        // Click en fila para seleccionar (solo en checkbox column)
        tr.querySelector(".col-check")?.addEventListener("click", (e) => {
            if (e.target.type === "checkbox") return;
            const idx = parseInt(tr.dataset.index);
            const isSelected = state.db.selectedRows.has(idx);
            
            if (isSelected) {
                state.db.selectedRows.delete(idx);
                tr.classList.remove("selected");
                checkbox.checked = false;
            } else {
                state.db.selectedRows.add(idx);
                tr.classList.add("selected");
                checkbox.checked = true;
            }
            updateDbStats();
            updateBulkEditButton();
        });
    });

    // Actualizar paginación
    document.getElementById("dbPageInfo").textContent = `Página ${state.db.currentPage} de ${totalPages}`;
    document.getElementById("dbPrevPage").disabled = state.db.currentPage <= 1;
    document.getElementById("dbNextPage").disabled = state.db.currentPage >= totalPages;

    updateDbStats();
    updateBulkEditButton();
}

function populateDbFilterOptions() {
    // Solo poblar si hay datos y los selects están vacíos (excepto "Todos")
    const tipoSelect = document.getElementById("filterDbTipo");
    if (tipoSelect && tipoSelect.options.length <= 1) {
        const tipos = [...new Set(state.rawData.map((r) => r.tipo))].filter(Boolean).sort();
        tipos.forEach((t) => {
            tipoSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
    }

    const ccSelect = document.getElementById("filterDbCC");
    if (ccSelect && ccSelect.options.length <= 1) {
        const ccs = [...new Set(state.rawData.map((r) => r.cc))].filter(Boolean).sort();
        ccs.forEach((c) => {
            ccSelect.innerHTML += `<option value="${c}">${c}</option>`;
        });
    }

    const itemSelect = document.getElementById("filterDbItem");
    if (itemSelect && itemSelect.options.length <= 1) {
        const items = [...new Set(state.rawData.map((r) => r.item))].filter(Boolean).sort();
        items.forEach((i) => {
            itemSelect.innerHTML += `<option value="${i}">${i}</option>`;
        });
    }

    const catSelect = document.getElementById("filterDbCategoria");
    if (catSelect && catSelect.options.length <= 1) {
        const cats = [...new Set(state.rawData.map((r) => r.categoria))].filter(Boolean).sort();
        cats.forEach((c) => {
            catSelect.innerHTML += `<option value="${c}">${c}</option>`;
        });
    }
}

function truncateText(text, maxLength) {
    if (!text) return "";
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
}

function getTotalPages() {
    const filtered = state.db.filteredData.length || state.rawData.length;
    const pageSize = state.db.pageSize === "all" ? filtered : state.db.pageSize;
    return Math.max(1, Math.ceil(filtered / pageSize));
}

function updateDbStats() {
    document.getElementById("dbTotalRows").textContent = state.rawData.length;
    document.getElementById("dbFilteredRows").textContent = state.db.filteredData.length || state.rawData.length;
    document.getElementById("dbSelectedRows").textContent = state.db.selectedRows.size;
}

function openNewRecordModal() {
    document.getElementById("editIndex").value = -1;
    document.getElementById("modalTitle").textContent = "Nuevo Registro";

    // Poblar selects con opciones únicas de los datos o defaults
    const defaultTipos = ["01_Ingreso", "02_Cargo", "03_Saldos iniciales", "04_Movimiento Interno"];
    const tipos = state.rawData.length > 0 ? getUniqueValues("tipo") : defaultTipos;
    const ccs = state.rawData.length > 0 ? getUniqueValues("cc") : ["CC Principal"];
    const items = state.rawData.length > 0 ? getUniqueValues("item") : ["Item General"];
    const categorias = state.rawData.length > 0 ? getUniqueValues("categoria") : ["Categoría General"];

    populateSelect("editTipo", tipos, tipos[0]);
    populateSelect("editCC", ccs, ccs[0]);
    populateSelect("editItem", items, items[0]);
    populateSelect("editCategoria", categorias, categorias[0]);

    document.getElementById("editSubcategoria").value = "";
    document.getElementById("editDetalle").value = "";
    document.getElementById("editMonto").value = "";
    document.getElementById("editFecha").value = new Date().toISOString().split("T")[0];

    document.getElementById("editModal").classList.add("active");
}

function openEditModal(index) {
    const row = state.rawData[index];
    if (!row) return;

    document.getElementById("editIndex").value = index;
    document.getElementById("modalTitle").textContent = "Editar Registro";

    // Poblar selects con opciones únicas de los datos
    populateSelect("editTipo", getUniqueValues("tipo"), row.tipo);
    populateSelect("editCC", getUniqueValues("cc"), row.cc);
    populateSelect("editItem", getUniqueValues("item"), row.item);
    populateSelect("editCategoria", getUniqueValues("categoria"), row.categoria);

    document.getElementById("editSubcategoria").value = row.subcategoria || "";
    document.getElementById("editDetalle").value = row.detalle || "";
    document.getElementById("editMonto").value = row.monto || 0;

    // Fecha
    if (row.fecha) {
        const dateStr = row.fecha.toISOString().split("T")[0];
        document.getElementById("editFecha").value = dateStr;
    } else {
        document.getElementById("editFecha").value = "";
    }

    document.getElementById("editModal").classList.add("active");
}

function closeModal() {
    document.getElementById("editModal").classList.remove("active");
}

function populateSelect(selectId, options, selectedValue) {
    const select = document.getElementById(selectId);
    if (!select) return;

    select.innerHTML = options.map((opt) => 
        `<option value="${opt}" ${opt === selectedValue ? "selected" : ""}>${opt}</option>`
    ).join("");
}

function getUniqueValues(field) {
    return [...new Set(state.rawData.map((r) => r[field]).filter(Boolean))].sort();
}

function saveEditedRow() {
    const index = parseInt(document.getElementById("editIndex").value);
    const isNewRecord = index === -1;

    let row;
    if (isNewRecord) {
        // Crear nuevo registro
        row = {};
    } else {
        if (!state.rawData[index]) return;
        row = state.rawData[index];
    }

    row.tipo = document.getElementById("editTipo").value;
    row.cc = document.getElementById("editCC").value;
    row.item = document.getElementById("editItem").value;
    row.categoria = document.getElementById("editCategoria").value;
    row.subcategoria = document.getElementById("editSubcategoria").value;
    row.detalle = document.getElementById("editDetalle").value;
    row.monto = parseFloat(document.getElementById("editMonto").value) || 0;

    const fechaStr = document.getElementById("editFecha").value;
    if (fechaStr) {
        row.fecha = new Date(fechaStr);
        row.year = row.fecha.getFullYear();
        row.month = row.fecha.getMonth();
    } else {
        row.fecha = null;
        row.year = null;
        row.month = null;
    }

    if (isNewRecord) {
        // Agregar nuevo registro al array
        state.rawData.push(row);
    }

    closeModal();
    
    // Actualizar opciones de filtro y reconstruir headers si es necesario
    extractFilterOptions();
    buildDynamicHeaders();
    buildCCButtons();
    
    renderDatabaseTable();

    // Actualizar otras vistas
    applyFilters();
    
    // Guardar cambios en localStorage
    saveToLocalStorage();

    if (isNewRecord) {
        alert("Registro creado correctamente.");
    }
}

function exportToCSV() {
    if (!state.rawData.length) {
        alert("No hay datos para exportar");
        return;
    }

    // Determinar qué datos exportar (seleccionados o todos los filtrados)
    let dataToExport;
    if (state.db.selectedRows.size > 0) {
        dataToExport = state.rawData.filter((_, idx) => state.db.selectedRows.has(idx));
    } else if (state.db.filteredData.length < state.rawData.length) {
        dataToExport = state.db.filteredData;
    } else {
        dataToExport = state.rawData;
    }

    // Crear CSV
    const headers = ["Tipo de movimiento", "Centro de costos", "Item", "Categoría", "Subcategoría", "Detalle", "Fecha", "Monto"];
    const rows = dataToExport.map((row) => {
        const fechaStr = row.fecha ? 
            `${row.fecha.getDate().toString().padStart(2, "0")}/${(row.fecha.getMonth() + 1).toString().padStart(2, "0")}/${row.fecha.getFullYear()}` : 
            "";
        return [
            row.tipo,
            row.cc,
            row.item,
            row.categoria,
            row.subcategoria,
            row.detalle,
            fechaStr,
            row.monto
        ].map((val) => `"${(val || "").toString().replace(/"/g, '""')}"`).join(";");
    });

    const csvContent = "\uFEFF" + headers.join(";") + "\n" + rows.join("\n");

    // Descargar
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `CRAMSA_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

// ===== EDICIÓN MASIVA =====
function openBulkEditModal() {
    if (state.db.selectedRows.size === 0) {
        alert("Seleccione al menos un registro para editar");
        return;
    }

    document.getElementById("bulkCount").textContent = state.db.selectedRows.size;

    // Poblar selects con opciones únicas
    populateSelect("bulkTipo", getUniqueValues("tipo"), "");
    populateSelect("bulkCC", getUniqueValues("cc"), "");
    populateSelect("bulkItem", getUniqueValues("item"), "");
    populateSelect("bulkCategoria", getUniqueValues("categoria"), "");

    // Reset checkboxes y campos
    ["Tipo", "CC", "Item", "Categoria", "Subcategoria"].forEach((field) => {
        const checkbox = document.getElementById(`bulkCheck${field}`);
        const input = document.getElementById(`bulk${field}`);
        if (checkbox) checkbox.checked = false;
        if (input) {
            input.disabled = true;
            input.value = "";
        }
    });

    document.getElementById("bulkEditModal").classList.add("active");
}

function closeBulkModal() {
    document.getElementById("bulkEditModal").classList.remove("active");
}

function saveBulkEdit() {
    const changes = {};
    let hasChanges = false;

    // Recoger campos marcados
    if (document.getElementById("bulkCheckTipo")?.checked) {
        changes.tipo = document.getElementById("bulkTipo").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckCC")?.checked) {
        changes.cc = document.getElementById("bulkCC").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckItem")?.checked) {
        changes.item = document.getElementById("bulkItem").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckCategoria")?.checked) {
        changes.categoria = document.getElementById("bulkCategoria").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckSubcategoria")?.checked) {
        changes.subcategoria = document.getElementById("bulkSubcategoria").value;
        hasChanges = true;
    }

    if (!hasChanges) {
        alert("Seleccione al menos un campo para modificar");
        return;
    }

    // Aplicar cambios a los registros seleccionados
    let count = 0;
    state.db.selectedRows.forEach((idx) => {
        const row = state.rawData[idx];
        if (row) {
            Object.assign(row, changes);
            count++;
        }
    });

    // Limpiar selección
    state.db.selectedRows.clear();
    document.getElementById("dbSelectAll").checked = false;

    closeBulkModal();
    
    // Actualizar vistas
    renderDatabaseTable();
    applyFilters();
    
    // Guardar cambios en localStorage
    saveToLocalStorage();

    alert(`Se actualizaron ${count} registros correctamente.`);
}

// ===== EXPORTAR A PDF =====
function setupExportPDF() {
    const btnExport = document.getElementById("btnExportPDF");
    btnExport?.addEventListener("click", exportToPDF);
}

async function exportToPDF() {
    // Verificar que html2pdf esté disponible
    if (typeof html2pdf === 'undefined') {
        alert("Error: La librería de PDF no está cargada. Por favor, recarga la página e intenta de nuevo.");
        console.error("html2pdf no está definido");
        return;
    }

    // Verificar que hay datos
    if (!state.filteredData || state.filteredData.length === 0) {
        alert("No hay datos para exportar. Importe un archivo CSV primero.");
        return;
    }

    // Mostrar loading
    const loadingOverlay = document.createElement("div");
    loadingOverlay.className = "pdf-loading-overlay";
    loadingOverlay.innerHTML = `
        <div class="pdf-loading-spinner"></div>
        <div class="pdf-loading-text">Generando informe PDF</div>
    `;
    document.body.appendChild(loadingOverlay);

    try {
        // Calcular datos para el informe
        const data = state.filteredData;
        const saldoInicial = data.filter((r) => r.tipo === "03_Saldos iniciales").reduce((acc, r) => acc + r.monto, 0);
        const totalIngresos = data.filter((r) => r.tipo === "01_Ingreso").reduce((acc, r) => acc + r.monto, 0);
        const totalEgresos = data.filter((r) => r.tipo === "02_Cargo").reduce((acc, r) => acc + Math.abs(r.monto), 0);
        const saldoFinal = saldoInicial + totalIngresos - totalEgresos;
        const flujoNeto = totalIngresos - totalEgresos;
        const ratio = totalEgresos > 0 ? (totalIngresos / totalEgresos).toFixed(2) : 'N/A';
        const variacion = saldoInicial !== 0 ? (((saldoFinal - saldoInicial) / Math.abs(saldoInicial)) * 100).toFixed(1) + '%' : 'N/A';
        
        // Obtener top categorías de gastos
        const gastosPorCategoria = {};
        data.filter(r => r.tipo === "02_Cargo").forEach(r => {
            const cat = r.categoria || "Sin categoría";
            gastosPorCategoria[cat] = (gastosPorCategoria[cat] || 0) + Math.abs(r.monto);
        });
        const topGastos = Object.entries(gastosPorCategoria)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Obtener top categorías de ingresos
        const ingresosPorCategoria = {};
        data.filter(r => r.tipo === "01_Ingreso").forEach(r => {
            const cat = r.categoria || "Sin categoría";
            ingresosPorCategoria[cat] = (ingresosPorCategoria[cat] || 0) + r.monto;
        });
        const topIngresos = Object.entries(ingresosPorCategoria)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);

        // Determinar período del reporte
        const fechas = data.filter(r => r.fecha).map(r => r.fecha);
        const fechaMin = fechas.length ? new Date(Math.min(...fechas)) : null;
        const fechaMax = fechas.length ? new Date(Math.max(...fechas)) : null;
        const periodoStr = fechaMin && fechaMax 
            ? `${fechaMin.toLocaleDateString("es-CL", { month: "long", year: "numeric" })} - ${fechaMax.toLocaleDateString("es-CL", { month: "long", year: "numeric" })}`
            : "Sin datos de período";

        // Filtro activo
        const filtroCC = state.currentCC === "all" ? "Todos los centros de costos" : state.currentCC;
        const fechaGeneracion = new Date().toLocaleDateString("es-CL", { 
            weekday: "long", year: "numeric", month: "long", day: "numeric" 
        });
        const horaGeneracion = new Date().toLocaleTimeString("es-CL");

        // Crear el contenido HTML del informe usando TABLAS para compatibilidad
        const reportHTML = `
            <div style="font-family: Arial, sans-serif; padding: 40px; background: #fff; color: #333; font-size: 12px; line-height: 1.5; width: 700px;">
                
                <!-- ENCABEZADO -->
                <table style="width: 100%; border-bottom: 3px solid #003978; padding-bottom: 15px; margin-bottom: 20px;">
                    <tr>
                        <td style="width: 150px; vertical-align: middle;">
                            <div style="background: #003978; color: white; padding: 10px 15px; border-radius: 5px; font-weight: bold; font-size: 18px;">CRAMSA</div>
                        </td>
                        <td style="text-align: right; vertical-align: middle;">
                            <div style="color: #003978; font-size: 22px; font-weight: bold; margin-bottom: 5px;">INFORME DE FLUJO DE CAJA</div>
                            <div style="color: #666; font-size: 11px;">${fechaGeneracion}</div>
                        </td>
                    </tr>
                </table>

                <!-- INFORMACIÓN DEL REPORTE -->
                <table style="width: 100%; background: #f5f7fa; border-left: 4px solid #003978; margin-bottom: 25px;">
                    <tr>
                        <td style="padding: 12px 15px;">
                            <strong style="color: #003978;">Período:</strong> ${periodoStr} &nbsp;&nbsp;|&nbsp;&nbsp;
                            <strong style="color: #003978;">Centro de Costos:</strong> ${filtroCC} &nbsp;&nbsp;|&nbsp;&nbsp;
                            <strong style="color: #003978;">Registros:</strong> ${data.length}
                        </td>
                    </tr>
                </table>

                <!-- RESUMEN EJECUTIVO -->
                <div style="color: #003978; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e0e6ed; padding-bottom: 8px; margin-bottom: 15px;">
                    RESUMEN EJECUTIVO
                </div>
                
                <table style="width: 100%; margin-bottom: 25px; border-collapse: separate; border-spacing: 10px 0;">
                    <tr>
                        <td style="width: 25%; background: #f5f5f5; border-left: 4px solid #616161; padding: 15px; text-align: center; border-radius: 5px;">
                            <div style="font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 5px;">Saldo Inicial</div>
                            <div style="font-size: 18px; font-weight: bold; color: #333;">${formatCurrency(saldoInicial)}</div>
                        </td>
                        <td style="width: 25%; background: #e8f5e9; border-left: 4px solid #2e7d32; padding: 15px; text-align: center; border-radius: 5px;">
                            <div style="font-size: 10px; color: #2e7d32; text-transform: uppercase; margin-bottom: 5px;">Total Ingresos</div>
                            <div style="font-size: 18px; font-weight: bold; color: #2e7d32;">${formatCurrency(totalIngresos)}</div>
                        </td>
                        <td style="width: 25%; background: #ffebee; border-left: 4px solid #c62828; padding: 15px; text-align: center; border-radius: 5px;">
                            <div style="font-size: 10px; color: #c62828; text-transform: uppercase; margin-bottom: 5px;">Total Egresos</div>
                            <div style="font-size: 18px; font-weight: bold; color: #c62828;">${formatCurrency(-totalEgresos)}</div>
                        </td>
                        <td style="width: 25%; background: #e3f2fd; border-left: 4px solid #1565c0; padding: 15px; text-align: center; border-radius: 5px;">
                            <div style="font-size: 10px; color: #1565c0; text-transform: uppercase; margin-bottom: 5px;">Saldo Final</div>
                            <div style="font-size: 18px; font-weight: bold; color: ${saldoFinal >= 0 ? '#1565c0' : '#c62828'};">${formatCurrency(saldoFinal)}</div>
                        </td>
                    </tr>
                </table>

                <!-- ANÁLISIS DE FLUJO -->
                <table style="width: 100%; margin-bottom: 25px;">
                    <tr>
                        <td style="width: 48%; vertical-align: top; padding-right: 15px;">
                            <div style="color: #2e7d32; font-size: 14px; font-weight: bold; margin-bottom: 10px; padding: 5px 10px; background: #e8f5e9; border-radius: 4px;">
                                ▲ Principales Ingresos
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                                <tr style="background: #f5f5f5;">
                                    <th style="padding: 8px; text-align: left; border-bottom: 2px solid #2e7d32;">Categoría</th>
                                    <th style="padding: 8px; text-align: right; border-bottom: 2px solid #2e7d32;">Monto</th>
                                </tr>
                                ${topIngresos.length > 0 ? topIngresos.map((item, idx) => `
                                    <tr style="background: ${idx % 2 === 0 ? '#fff' : '#fafafa'};">
                                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item[0]}</td>
                                        <td style="padding: 8px; text-align: right; border-bottom: 1px solid #eee; color: #2e7d32; font-weight: bold;">${formatCurrency(item[1])}</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="2" style="padding: 15px; text-align: center; color: #999;">Sin datos</td></tr>'}
                            </table>
                        </td>
                        <td style="width: 48%; vertical-align: top; padding-left: 15px;">
                            <div style="color: #c62828; font-size: 14px; font-weight: bold; margin-bottom: 10px; padding: 5px 10px; background: #ffebee; border-radius: 4px;">
                                ▼ Principales Gastos
                            </div>
                            <table style="width: 100%; border-collapse: collapse; font-size: 11px;">
                                <tr style="background: #f5f5f5;">
                                    <th style="padding: 8px; text-align: left; border-bottom: 2px solid #c62828;">Categoría</th>
                                    <th style="padding: 8px; text-align: right; border-bottom: 2px solid #c62828;">Monto</th>
                                </tr>
                                ${topGastos.length > 0 ? topGastos.map((item, idx) => `
                                    <tr style="background: ${idx % 2 === 0 ? '#fff' : '#fafafa'};">
                                        <td style="padding: 8px; border-bottom: 1px solid #eee;">${item[0]}</td>
                                        <td style="padding: 8px; text-align: right; border-bottom: 1px solid #eee; color: #c62828; font-weight: bold;">${formatCurrency(-item[1])}</td>
                                    </tr>
                                `).join('') : '<tr><td colspan="2" style="padding: 15px; text-align: center; color: #999;">Sin datos</td></tr>'}
                            </table>
                        </td>
                    </tr>
                </table>

                <!-- INDICADORES CLAVE -->
                <div style="color: #003978; font-size: 16px; font-weight: bold; border-bottom: 2px solid #e0e6ed; padding-bottom: 8px; margin-bottom: 15px;">
                    INDICADORES CLAVE
                </div>
                
                <table style="width: 100%; margin-bottom: 25px; border-collapse: separate; border-spacing: 10px 0;">
                    <tr>
                        <td style="width: 33%; background: #fff; border: 1px solid #e0e6ed; padding: 15px; border-radius: 5px;">
                            <div style="font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 5px;">Flujo Neto</div>
                            <div style="font-size: 20px; font-weight: bold; color: ${flujoNeto >= 0 ? '#2e7d32' : '#c62828'};">${formatCurrency(flujoNeto)}</div>
                            <div style="font-size: 9px; color: #666; margin-top: 5px;">Ingresos - Egresos</div>
                        </td>
                        <td style="width: 33%; background: #fff; border: 1px solid #e0e6ed; padding: 15px; border-radius: 5px;">
                            <div style="font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 5px;">Ratio I/E</div>
                            <div style="font-size: 20px; font-weight: bold; color: #003978;">${ratio}</div>
                            <div style="font-size: 9px; color: #666; margin-top: 5px;">${ratio !== 'N/A' && parseFloat(ratio) >= 1 ? 'Positivo' : 'Requiere atención'}</div>
                        </td>
                        <td style="width: 33%; background: #fff; border: 1px solid #e0e6ed; padding: 15px; border-radius: 5px;">
                            <div style="font-size: 10px; color: #666; text-transform: uppercase; margin-bottom: 5px;">Variación</div>
                            <div style="font-size: 20px; font-weight: bold; color: ${saldoFinal >= saldoInicial ? '#2e7d32' : '#c62828'};">${variacion}</div>
                            <div style="font-size: 9px; color: #666; margin-top: 5px;">vs Saldo Inicial</div>
                        </td>
                    </tr>
                </table>

                <!-- PIE DE PÁGINA -->
                <table style="width: 100%; border-top: 1px solid #e0e6ed; margin-top: 30px; padding-top: 15px;">
                    <tr>
                        <td style="color: #999; font-size: 10px;">CRAMSA - Control Financiero</td>
                        <td style="color: #999; font-size: 10px; text-align: center;">Generado: ${horaGeneracion}</td>
                        <td style="color: #999; font-size: 10px; text-align: right;">Página 1 de 1</td>
                    </tr>
                </table>
            </div>
        `;

        // Crear contenedor temporal
        const tempContainer = document.createElement("div");
        tempContainer.style.position = "absolute";
        tempContainer.style.left = "-9999px";
        tempContainer.style.top = "0";
        tempContainer.innerHTML = reportHTML;
        document.body.appendChild(tempContainer);

        // Esperar un momento para que el DOM se actualice
        await new Promise(resolve => setTimeout(resolve, 100));

        // Obtener el elemento a convertir (el div interno con el contenido)
        const elementToConvert = tempContainer.querySelector('div');
        if (!elementToConvert) {
            throw new Error("No se pudo encontrar el elemento para convertir a PDF");
        }

        // Configuración de html2pdf - Tamaño Carta
        const opt = {
            margin: [10, 10, 10, 10],
            filename: `CRAMSA_Informe_${new Date().toISOString().slice(0, 10)}.pdf`,
            image: { type: "jpeg", quality: 0.98 },
            html2canvas: { 
                scale: 2,
                logging: false,
                useCORS: true
            },
            jsPDF: { 
                unit: "mm", 
                format: "letter",
                orientation: "portrait" 
            }
        };

        // Generar PDF
        await html2pdf().set(opt).from(elementToConvert).save();

        // Limpiar
        document.body.removeChild(tempContainer);
    } catch (error) {
        console.error("Error al generar PDF:", error);
        let errorMsg = "Error al generar el PDF.";
        if (error.message) {
            errorMsg += " Detalles: " + error.message;
        }
        if (error.name === "SecurityError") {
            errorMsg = "Error de seguridad al generar el PDF. Verifica que el navegador permite la generación de archivos.";
        }
        alert(errorMsg);
    } finally {
        // Remover loading
        if (loadingOverlay && loadingOverlay.parentNode) {
            document.body.removeChild(loadingOverlay);
        }
        // Limpiar contenedor temporal si existe
        const tempContainer = document.querySelector('[style*="left: -9999px"]');
        if (tempContainer && tempContainer.parentNode) {
            document.body.removeChild(tempContainer);
        }
    }
}

// ===== NUEVO REGISTRO =====
function openNewRecordModal() {
    document.getElementById("editIndex").value = "-1"; // -1 indica nuevo registro
    document.getElementById("modalTitle").textContent = "Nuevo Registro";

    // Poblar selects con opciones únicas de los datos (o valores por defecto)
    const tipos = getUniqueValues("tipo");
    const ccs = getUniqueValues("cc");
    const items = getUniqueValues("item");
    const categorias = getUniqueValues("categoria");

    populateSelect("editTipo", tipos.length ? tipos : ["01_Ingreso", "02_Cargo", "03_Saldos iniciales", "04_Movimiento Interno"], "");
    populateSelect("editCC", ccs.length ? ccs : [""], "");
    populateSelect("editItem", items.length ? items : [""], "");
    populateSelect("editCategoria", categorias.length ? categorias : [""], "");

    document.getElementById("editSubcategoria").value = "";
    document.getElementById("editDetalle").value = "";
    document.getElementById("editMonto").value = 0;
    document.getElementById("editFecha").value = new Date().toISOString().split("T")[0];

    document.getElementById("editModal").classList.add("active");
}

// ===== EDICIÓN INLINE =====
function startInlineEdit(td, tr) {
    // Si ya está en modo edición, no hacer nada
    if (td.classList.contains("editing")) return;

    const field = td.dataset.field;
    const type = td.dataset.type;
    const idx = parseInt(tr.dataset.index);
    const row = state.rawData[idx];
    if (!row) return;

    // Obtener valor actual
    let currentValue;
    if (field === "fecha") {
        currentValue = td.dataset.value || "";
    } else if (field === "monto") {
        currentValue = row.monto || 0;
    } else {
        currentValue = row[field] || "";
        if (currentValue === "-") currentValue = "";
    }

    // Guardar contenido original
    const originalContent = td.innerHTML;

    // Crear input según el tipo
    let input;
    if (type === "date") {
        input = document.createElement("input");
        input.type = "date";
        input.value = currentValue;
    } else if (type === "number") {
        input = document.createElement("input");
        input.type = "number";
        input.step = "1";
        input.value = currentValue;
    } else {
        input = document.createElement("input");
        input.type = "text";
        input.value = currentValue;
    }

    td.innerHTML = "";
    td.classList.add("editing");
    td.appendChild(input);
    input.focus();
    input.select();

    // Función para guardar cambios
    const saveInlineEdit = () => {
        const newValue = input.value;
        td.classList.remove("editing");

        // Actualizar el valor en state.rawData
        if (field === "fecha") {
            if (newValue) {
                row.fecha = new Date(newValue);
                row.year = row.fecha.getFullYear();
                row.month = row.fecha.getMonth();
                td.dataset.value = newValue;
                td.innerHTML = row.fecha.toLocaleDateString("es-CL");
            } else {
                row.fecha = null;
                row.year = null;
                row.month = null;
                td.dataset.value = "";
                td.innerHTML = "-";
            }
        } else if (field === "monto") {
            row.monto = parseFloat(newValue) || 0;
            td.innerHTML = formatCurrency(row.monto);
            td.className = "";
            td.dataset.editable = "true";
            td.dataset.field = "monto";
            td.dataset.type = "number";
            if (row.monto < 0) td.classList.add("val-negative");
            else if (row.monto > 0) td.classList.add("val-positive");
        } else {
            row[field] = newValue || "";
            if (field === "detalle") {
                td.innerHTML = truncateText(newValue, 30) || "-";
                td.title = newValue || "";
            } else {
                td.innerHTML = newValue || "-";
            }
        }

        // Guardar en localStorage y actualizar filtros
        saveToLocalStorage();
        extractFilterOptions();
        applyFilters();
    };

    // Cancelar edición
    const cancelInlineEdit = () => {
        td.classList.remove("editing");
        td.innerHTML = originalContent;
    };

    // Event listeners
    input.addEventListener("blur", saveInlineEdit);
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            input.blur();
        } else if (e.key === "Escape") {
            e.preventDefault();
            input.removeEventListener("blur", saveInlineEdit);
            cancelInlineEdit();
        }
    });
}
