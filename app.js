/**
 * Control Financiero - Dashboard de Flujo de Caja
 * Adaptado para CSV con estructura: Abonos;Empresa;Tipo de movimiento;Grupo;Categoría;Subcategoría;Codigo;Mes;Valor
 */

const monthLabels = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

const state = {
    rawData: [],
    filteredData: [],
    meses: [], // Lista de meses únicos ordenados (mesKey)
    currentEmpresa: "all",
    mesDesde: null,
    mesHasta: null,
    mesActual: null, // Mes actual seleccionado (para distinguir real vs proyección)
    rangeMinIdx: 0,
    rangeMaxIdx: 0,
    groupLevels: { tipo: true, grupo: true, categoria: true },
    paretoThreshold: 0.8,
    charts: {},
    summaryInsights: [],
    kpiUseFullRange: true, // true = inicio a mes actual, false = usar rango seleccionado
    // Estado para Base de Datos
    db: {
        searchTerm: "",
        currentPage: 1,
        pageSize: 50,
        selectedRows: new Set(),
        filteredData: [],
        isEditMode: false,
        filters: {
            abono: "",
            empresa: "",
            tipo: "",
            grupo: "",
            categoria: "",
            subcategoria: "",
            codigo: "",
            mes: "",
            valorMin: null,
            valorMax: null
        }
    }
};

// Colores para gráficos - Paleta Corporativa CRAMSA
const chartColors = {
    ingresos: { border: "#00a878", bg: "rgba(0, 168, 120, 0.35)" },
    egresos: { border: "#e63946", bg: "rgba(230, 57, 70, 0.35)" }
};

// Paleta corporativa CRAMSA para gráficos
const cramsaPalette = {
    primary: '#003978',      // PANTONE 281 C - Azul corporativo
    secondary: '#007BA5',    // PANTONE 314 C - Azul secundario
    gold: '#F2A900',         // PANTONE 130 C - Dorado
    black: '#101820',        // PANTONE Black 6 C
    brown: '#6E4C1E',        // PANTONE 1405 C
    navy: '#13294B',         // PANTONE 2767 C
    orange: '#FC4C02',       // PANTONE 1655 C
    tealDark: '#005670',     // PANTONE 7708 C
    teal: '#4298B5',         // PANTONE 7459 C
    tealDeep: '#005A6F',     // PANTONE 7470 C
    // Colores adicionales para gráficos
    chartColors: [
        '#003978', '#007BA5', '#4298B5', '#005670', '#005A6F',
        '#F2A900', '#FC4C02', '#13294B', '#6E4C1E', '#101820'
    ]
};

document.addEventListener("DOMContentLoaded", () => {
    setupNavTabs();
    setupEmpresaFilters();
    setupRangeSlider();
    setupMesActualFilter();
    setupImportCSV();
    setupClearData();
    setupExpandCollapse();
    setupParetoFilters();
    setupGroupCheckboxes();
    setupDatabaseControls();
    setupSummaryTools();
    
    // Intentar cargar datos guardados en localStorage
    loadFromLocalStorage();
});

// ===== PERSISTENCIA EN LOCALSTORAGE =====
function saveToLocalStorage() {
    try {
        localStorage.setItem("flujo_caja_data", JSON.stringify(state.rawData));
    } catch (e) {
        console.warn("No se pudo guardar en localStorage:", e);
    }
}

function loadFromLocalStorage() {
    try {
        const savedData = localStorage.getItem("flujo_caja_data");
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            if (parsedData && parsedData.length > 0) {
                state.rawData = parsedData;
                extractFilterOptions();
                buildDynamicHeaders();
                buildEmpresaButtons();
                applyFilters();
                return;
            }
        }
    } catch (e) {
        console.warn("No se pudo cargar desde localStorage:", e);
    }
    
    showEmptyState();
}

function clearLocalStorage() {
    try {
        localStorage.removeItem("flujo_caja_data");
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
    if (summaryBody) summaryBody.innerHTML = `<tr><td class="empty-message">Importe el archivo CSV para visualizar los datos</td></tr>`;
    if (movementsHead) movementsHead.innerHTML = "";
    if (movementsBody) movementsBody.innerHTML = `<tr><td class="empty-message">Importe el archivo CSV para visualizar los datos</td></tr>`;

    // Destruir gráficos
    destroyChart("line");
    destroyChart("donut");
    destroyChart("horizontal");
    destroyChart("pareto");

    // Limpiar tabla Pareto
    const paretoBody = document.getElementById("paretoBody");
    if (paretoBody) paretoBody.innerHTML = `<tr><td colspan="4" class="empty-message">Sin datos</td></tr>`;
}

// ===== PROCESAMIENTO DE DATOS =====
function processData(data) {
    state.rawData = data.map(normalizeRow).filter(Boolean);
    extractFilterOptions();
    applyFilters();
}

/**
 * Parsea el formato de mes MM-YY a un objeto con año y mes
 * Ej: "03-25" -> { year: 2025, month: 2 } (marzo = índice 2)
 */
function parseMes(mesStr) {
    if (!mesStr || typeof mesStr !== 'string') return null;
    
    const match = mesStr.trim().match(/^(\d{2})-(\d{2})$/);
    if (!match) return null;
    
    const month = parseInt(match[1], 10) - 1; // Convertir a índice 0-11
    const yearShort = parseInt(match[2], 10);
    const year = yearShort >= 0 && yearShort <= 50 ? 2000 + yearShort : 1900 + yearShort;
    
    if (month < 0 || month > 11) return null;
    
    return { year, month, original: mesStr };
}

/**
 * Convierte año y mes a formato de ordenación numérico
 * Ej: 2025, 2 (marzo) -> 202502
 */
function getMesKey(year, month) {
    return year * 100 + (month + 1);
}

/**
 * Formatea un mes para mostrar
 * Ej: { year: 2025, month: 2 } -> "mar-25"
 */
function formatMesDisplay(year, month) {
    return `${monthLabels[month]}-${String(year).slice(-2)}`;
}

function normalizeRow(row) {
    const tipo = row["Tipo de movimiento"]?.trim();
    if (!tipo) return null;

    const mesStr = row["Mes"]?.trim();
    const mesParsed = parseMes(mesStr);
    if (!mesParsed) return null;

    const valor = Number(row["Valor"]) || 0;

    return {
        abono: row["Abonos"]?.trim() || "",
        empresa: row["Empresa"]?.trim() || "",
        tipo,
        grupo: row["Grupo"]?.trim() || "-",
        categoria: row["Categoría"]?.trim() || "Sin categoría",
        subcategoria: row["Subcategoría"]?.trim() || "-",
        codigo: row["Codigo"]?.trim() || "",
        mes: mesStr,
        year: mesParsed.year,
        month: mesParsed.month,
        mesKey: getMesKey(mesParsed.year, mesParsed.month),
        valor
    };
}

function extractFilterOptions() {
    // Extraer meses únicos y ordenarlos
    const mesesSet = new Set();
    state.rawData.forEach(r => {
        if (r.mesKey) mesesSet.add(r.mesKey);
    });
    state.meses = Array.from(mesesSet).sort((a, b) => a - b);

    // Poblar selects de mes
    populateMesSelects();
}

function populateMesSelects() {
    // Auto-seleccionar noviembre 2025 si existe (11-25 = 202511)
    const nov25 = 202511;
    if (state.meses.includes(nov25)) {
        state.mesActual = nov25;
        monthPickerYear = 2025;
        
        // Actualizar botón del month picker
        const btn = document.getElementById("monthPickerValue");
        if (btn) {
            btn.textContent = "Nov 2025";
        }
        updateMesActualInfo();
    } else if (state.meses.length > 0) {
        // Si no hay nov 2025, usar el último mes disponible
        const lastMes = state.meses[state.meses.length - 1];
        monthPickerYear = Math.floor(lastMes / 100);
    }
    
    // Inicializar el range slider
    initializeRangeSlider();
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

function setupEmpresaFilters() {
    const buttons = document.querySelectorAll(".empresa-btn");
    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");
            state.currentEmpresa = btn.dataset.empresa;
            applyFilters();
        });
    });
}

let rangeSlider = null;

function setupRangeSlider() {
    const btnClear = document.getElementById("btnClearDates");
    
    btnClear?.addEventListener("click", () => {
        resetRangeSlider();
        applyFilters();
    });
}

// Estado del month picker
let monthPickerYear = new Date().getFullYear();

function setupMesActualFilter() {
    const btn = document.getElementById("monthPickerBtn");
    const dropdown = document.getElementById("monthPickerDropdown");
    const prevYear = document.getElementById("monthPickerPrevYear");
    const nextYear = document.getElementById("monthPickerNextYear");
    
    // Toggle dropdown
    btn?.addEventListener("click", (e) => {
        e.stopPropagation();
        dropdown?.classList.toggle("active");
        if (dropdown?.classList.contains("active")) {
            renderMonthPicker();
        }
    });
    
    // Cerrar al hacer click fuera
    document.addEventListener("click", (e) => {
        if (!e.target.closest(".month-picker-container")) {
            dropdown?.classList.remove("active");
        }
    });
    
    // Navegación de años
    prevYear?.addEventListener("click", (e) => {
        e.stopPropagation();
        monthPickerYear--;
        renderMonthPicker();
    });
    
    nextYear?.addEventListener("click", (e) => {
        e.stopPropagation();
        monthPickerYear++;
        renderMonthPicker();
    });
}

function renderMonthPicker() {
    const grid = document.getElementById("monthPickerGrid");
    const yearLabel = document.getElementById("monthPickerYear");
    const prevBtn = document.getElementById("monthPickerPrevYear");
    const nextBtn = document.getElementById("monthPickerNextYear");
    
    if (!grid) return;
    
    yearLabel.textContent = monthPickerYear;
    
    // Determinar años disponibles
    const availableYears = [...new Set(state.meses.map(m => Math.floor(m / 100)))];
    const minYear = Math.min(...availableYears);
    const maxYear = Math.max(...availableYears);
    
    // Habilitar/deshabilitar botones de navegación
    if (prevBtn) prevBtn.disabled = monthPickerYear <= minYear;
    if (nextBtn) nextBtn.disabled = monthPickerYear >= maxYear;
    
    // Generar grid de meses
    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    
    grid.innerHTML = monthNames.map((name, idx) => {
        const mesKey = monthPickerYear * 100 + (idx + 1);
        const isAvailable = state.meses.includes(mesKey);
        const isSelected = state.mesActual === mesKey;
        
        return `<button 
            class="month-picker-item ${isSelected ? 'selected' : ''} ${isAvailable ? 'available' : ''}" 
            data-meskey="${mesKey}"
            ${!isAvailable ? 'disabled' : ''}
            type="button"
        >${name}</button>`;
    }).join("");
    
    // Event listeners para selección
    grid.querySelectorAll(".month-picker-item:not(:disabled)").forEach(item => {
        item.addEventListener("click", (e) => {
            e.stopPropagation();
            const mesKey = parseInt(item.dataset.meskey);
            selectMonth(mesKey);
        });
    });
}

function selectMonth(mesKey) {
    state.mesActual = mesKey;
    
    // Actualizar botón
    const btn = document.getElementById("monthPickerValue");
    if (btn) {
        const year = Math.floor(mesKey / 100);
        const month = (mesKey % 100) - 1;
        btn.textContent = `${monthLabels[month].charAt(0).toUpperCase() + monthLabels[month].slice(1)} ${year}`;
    }
    
    // Cerrar dropdown
    document.getElementById("monthPickerDropdown")?.classList.remove("active");
    
    // Actualizar info y filtros
    updateMesActualInfo();
    applyFilters();
}

function initializeRangeSlider() {
    const sliderEl = document.getElementById("mesRangeSlider");
    if (!sliderEl || state.meses.length === 0) return;
    
    // Destruir slider existente si hay uno
    if (rangeSlider) {
        rangeSlider.destroy();
        rangeSlider = null;
    }
    
    const maxIdx = state.meses.length - 1;
    
    rangeSlider = noUiSlider.create(sliderEl, {
        start: [0, maxIdx],
        connect: true,
        step: 1,
        range: {
            'min': 0,
            'max': maxIdx
        },
        tooltips: [
            { to: (val) => formatMesTooltip(Math.round(val)) },
            { to: (val) => formatMesTooltip(Math.round(val)) }
        ]
    });
    
    rangeSlider.on('update', (values) => {
        const minIdx = Math.round(values[0]);
        const maxIdx = Math.round(values[1]);
        
        state.rangeMinIdx = minIdx;
        state.rangeMaxIdx = maxIdx;
        state.mesDesde = state.meses[minIdx] || null;
        state.mesHasta = state.meses[maxIdx] || null;
        
        updateSliderLabels();
    });
    
    rangeSlider.on('change', () => {
        applyFilters();
    });
    
    state.rangeMinIdx = 0;
    state.rangeMaxIdx = maxIdx;
    state.mesDesde = state.meses[0];
    state.mesHasta = state.meses[maxIdx];
    
    updateSliderLabels();
}

function formatMesTooltip(idx) {
    if (!state.meses[idx]) return '';
    const mesKey = state.meses[idx];
    const year = Math.floor(mesKey / 100);
    const month = (mesKey % 100) - 1;
    return formatMesDisplay(year, month);
}

function updateSliderLabels() {
    const minLabel = document.getElementById("rangeMinLabel");
    const maxLabel = document.getElementById("rangeMaxLabel");
    const monthsCount = document.getElementById("rangeMonthsCount");
    
    if (state.meses.length === 0) {
        if (minLabel) minLabel.textContent = "-";
        if (maxLabel) maxLabel.textContent = "-";
        if (monthsCount) monthsCount.textContent = "0 meses";
        return;
    }
    
    const minMesKey = state.meses[state.rangeMinIdx];
    const maxMesKey = state.meses[state.rangeMaxIdx];
    
    if (minLabel && minMesKey) {
        const year = Math.floor(minMesKey / 100);
        const month = (minMesKey % 100) - 1;
        minLabel.textContent = formatMesDisplay(year, month);
    }
    
    if (maxLabel && maxMesKey) {
        const year = Math.floor(maxMesKey / 100);
        const month = (maxMesKey % 100) - 1;
        maxLabel.textContent = formatMesDisplay(year, month);
    }
    
    // Actualizar contador de meses
    if (monthsCount) {
        const count = state.rangeMaxIdx - state.rangeMinIdx + 1;
        monthsCount.textContent = `${count} ${count === 1 ? 'mes' : 'meses'}`;
    }
}

function resetRangeSlider() {
    if (!rangeSlider || state.meses.length === 0) return;
    
    const maxIdx = state.meses.length - 1;
    rangeSlider.set([0, maxIdx]);
    
    state.rangeMinIdx = 0;
    state.rangeMaxIdx = maxIdx;
    state.mesDesde = state.meses[0];
    state.mesHasta = state.meses[maxIdx];
    
    updateSliderLabels();
}

function updateMesActualInfo() {
    const infoEl = document.getElementById("mesActualInfo");
    if (!infoEl) return;
    
    if (!state.mesActual) {
        infoEl.textContent = "";
        return;
    }
    
    const mesActualIdx = state.meses.indexOf(state.mesActual);
    if (mesActualIdx === -1) {
        infoEl.textContent = "";
        return;
    }
    
    const mesesReales = mesActualIdx + 1;
    const mesesProyectados = state.meses.length - mesesReales;
    
    infoEl.innerHTML = `<span class="real-badge">${mesesReales} real${mesesReales !== 1 ? 'es' : ''}</span> <span class="proj-badge">${mesesProyectados} proyectado${mesesProyectados !== 1 ? 's' : ''}</span>`;
}

function setupImportCSV() {
    const btnImport = document.getElementById("btnImport");
    const csvInput = document.getElementById("csvInput");

    btnImport?.addEventListener("click", () => csvInput?.click());

    csvInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            delimiter: ";",
            encoding: "UTF-8",
            skipEmptyLines: true,
            complete: ({ data }) => {
                const validData = data.filter(row => row["Tipo de movimiento"]?.trim());
                
                if (validData.length === 0) {
                    // Intentar con ISO-8859-1
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
        csvInput.value = "";
    });
}

function processImportedData(data) {
    resetDbFilters();
    processData(data);
    buildDynamicHeaders();
    buildEmpresaButtons();
    saveToLocalStorage();
    
    alert(`CSV importado: ${state.rawData.length} registros cargados.`);
}

function setupClearData() {
    const btnClear = document.getElementById("btnClearData");
    btnClear?.addEventListener("click", () => {
        if (confirm("¿Está seguro de que desea limpiar todos los datos?")) {
            state.rawData = [];
            state.filteredData = [];
            state.meses = [];
            state.currentEmpresa = "all";
            state.mesDesde = null;
            state.mesHasta = null;

            clearLocalStorage();

            // Limpiar selects de mes
            const mesDesde = document.getElementById("mesDesde");
            const mesHasta = document.getElementById("mesHasta");
            if (mesDesde) mesDesde.value = "";
            if (mesHasta) mesHasta.value = "";

            // Resetear botones Empresa
            const empresaContainer = document.querySelector(".empresa-filters");
            if (empresaContainer) {
                empresaContainer.innerHTML = `
                    <span class="filter-label">Empresa:</span>
                    <button class="empresa-btn active" data-empresa="all">Consolidado</button>
                `;
                setupEmpresaFilters();
            }

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
            abono: "",
            empresa: "",
            tipo: "",
            grupo: "",
            categoria: "",
            subcategoria: "",
            codigo: "",
            mes: "",
            valorMin: null,
            valorMax: null
        }
    };

    // Limpiar UI de filtros
    const filterIds = ["dbSearch", "filterDbAbono", "filterDbSubcat", "filterDbCodigo", "filterDbValorMin", "filterDbValorMax"];
    filterIds.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });

    ["filterDbEmpresa", "filterDbTipo", "filterDbGrupo", "filterDbCategoria", "filterDbMes"].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = `<option value="">Todos</option>`;
    });

    const selectAll = document.getElementById("dbSelectAll");
    if (selectAll) selectAll.checked = false;

    const btnEditMode = document.getElementById("btnEditMode");
    btnEditMode?.classList.remove("active");

    updateBulkEditButton();
}

function buildDynamicHeaders() {
    const columns = getColumns();
    const summaryHead = document.getElementById("summaryHead");
    const movementsHead = document.getElementById("movementsHead");
    const summaryDateRange = document.getElementById("summaryDateRange");
    const movementsDateRange = document.getElementById("movementsDateRange");

    // Actualizar badges de rango de fechas
    if (columns.length > 0) {
        const firstCol = columns[0];
        const lastCol = columns[columns.length - 1];
        const rangeText = `${monthLabels[firstCol.month].substring(0, 3)} ${firstCol.year} → ${monthLabels[lastCol.month].substring(0, 3)} ${lastCol.year}`;
        
        if (summaryDateRange) summaryDateRange.textContent = rangeText;
        if (movementsDateRange) movementsDateRange.textContent = rangeText;
    } else {
        if (summaryDateRange) summaryDateRange.textContent = "";
        if (movementsDateRange) movementsDateRange.textContent = "";
    }

    if (columns.length === 0) {
        if (summaryHead) summaryHead.innerHTML = "";
        if (movementsHead) movementsHead.innerHTML = "";
        return;
    }

    // Agrupar columnas por año
    const yearGroups = {};
    columns.forEach((col) => {
        if (!yearGroups[col.year]) yearGroups[col.year] = [];
        yearGroups[col.year].push(col);
    });

    const years = Object.keys(yearGroups).sort();
    
    // Función para determinar si un mes es proyectado
    const isProjected = (mesKey) => {
        if (!state.mesActual) return false;
        return mesKey > state.mesActual;
    };
    
    // Función para determinar si es el mes actual
    const isMesActual = (mesKey) => {
        return state.mesActual && mesKey === state.mesActual;
    };

    // Header para Summary
    if (summaryHead) {
        let yearRow = "<tr><th></th>";
        let monthRow = "<tr><th></th>";

        years.forEach((year, idx) => {
            const count = yearGroups[year].length;
            const altClass = idx > 0 ? " year-alt" : "";
            yearRow += `<th colspan="${count}" class="year-header${altClass}">${year}</th>`;
            yearGroups[year].forEach((col) => {
                const projClass = isProjected(col.mesKey) ? " projected-month" : "";
                const mesActualClass = isMesActual(col.mesKey) ? " col-mes-actual" : "";
                monthRow += `<th class="${projClass}${mesActualClass}">${monthLabels[col.month]}</th>`;
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
            <th class="col-grupo">Grupo</th>
            <th class="col-categoria">Categoría</th>
            <th class="col-subcategoria">Subcategoría</th>`;

        const firstYear = years[0];
        columns.forEach((col) => {
            const isSecondYear = col.year > parseInt(firstYear);
            const projClass = isProjected(col.mesKey) ? " projected-month" : "";
            const mesActualClass = isMesActual(col.mesKey) ? " col-mes-actual" : "";
            headerRow += `<th class="${isSecondYear ? "col-2026" : ""}${projClass}${mesActualClass}">${monthLabels[col.month]}</th>`;
        });

        headerRow += "</tr>";
        movementsHead.innerHTML = headerRow;
    }
}

function buildEmpresaButtons() {
    const empresaContainer = document.querySelector(".empresa-filters");
    if (!empresaContainer) return;

    // Obtener empresas únicas de los datos
    const uniqueEmpresas = [...new Set(state.rawData.map((r) => r.empresa))].filter(Boolean);

    // Orden específico: CRAMSA - INFRA - GRUPO - ADD
    const empresaOrder = {
        "CRAMSA": 1,
        "INFRA": 2,
        "GRUPO": 3,
        "ADD": 4
    };
    
    // Nombres completos para tooltip
    const empresaNames = {
        "CRAMSA": "CRAMSA S.A.",
        "INFRA": "CRAMSA Infraestructura SpA.",
        "GRUPO": "Grupo CRAMSA",
        "ADD": "Aguas del Desierto"
    };
    
    // Ordenar según el orden específico
    uniqueEmpresas.sort((a, b) => {
        const orderA = empresaOrder[a] || 999;
        const orderB = empresaOrder[b] || 999;
        return orderA - orderB;
    });

    let html = `<span class="filter-label">Empresa:</span>
                <button class="empresa-btn active" data-empresa="all" title="Todas las empresas">TODAS</button>`;

    uniqueEmpresas.forEach((empresa) => {
        const fullName = empresaNames[empresa] || empresa;
        html += `<button class="empresa-btn" data-empresa="${empresa}" title="${fullName}">${empresa}</button>`;
    });

    empresaContainer.innerHTML = html;
    setupEmpresaFilters();
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
        grupo: document.getElementById("groupGrupo"),
        categoria: document.getElementById("groupCategoria")
    };

    Object.entries(checkboxes).forEach(([key, checkbox]) => {
        checkbox?.addEventListener("change", () => {
            state.groupLevels[key] = checkbox.checked;
            renderMovementsTable();
        });
    });
}

function setupSummaryTools() {
    document.getElementById("btnResumenPDF")?.addEventListener("click", exportResumenPDF);
    document.getElementById("btnMostrarTodo")?.addEventListener("click", () => {
        resetRangeSlider();
        applyFilters();
    });
    document.getElementById("btnIrMesActual")?.addEventListener("click", scrollToMesActual);
    document.getElementById("btnComparativa")?.addEventListener("click", showComparativaModal);
    document.getElementById("btnTendencia")?.addEventListener("click", showTendenciaAnalysis);
    document.getElementById("btnProyeccion")?.addEventListener("click", showProyeccionAnalysis);
    document.getElementById("btnAnalisisCategoria")?.addEventListener("click", showCategoriaAnalysis);
    document.getElementById("btnExportarDatos")?.addEventListener("click", exportToCSV);
    
    // Toggle para modo de KPI (inicio a mes actual vs rango seleccionado)
    const kpiToggle = document.getElementById("kpiModeToggle");
    const kpiModeText = document.getElementById("kpiModeText");
    if (kpiToggle) {
        // Sincronizar estado inicial
        kpiToggle.checked = state.kpiUseFullRange;
        if (kpiModeText) {
            kpiModeText.textContent = state.kpiUseFullRange ? "Inicio → Mes actual" : "Meses del rango";
        }
        
        kpiToggle.addEventListener("change", (e) => {
            state.kpiUseFullRange = e.target.checked;
            if (kpiModeText) {
                kpiModeText.textContent = e.target.checked ? "Inicio → Mes actual" : "Meses del rango";
            }
            renderKPIs();
            renderHorizontalChart();
            renderParetoSection();
        });
    }
}

function exportResumenPDF() {
    const section = document.querySelector(".summary-section");
    if (!section || typeof html2pdf === "undefined") {
        alert("No se pudo generar el PDF en este navegador.");
        return;
    }

    const options = {
        margin: 10,
        filename: `resumen_flujo_${new Date().toISOString().slice(0, 10)}.pdf`,
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "landscape" }
    };

    html2pdf().set(options).from(section).save();
}

// Funciones de análisis avanzado
function showComparativaModal() {
    if (state.filteredData.length === 0) {
        alert("Importa datos primero para realizar comparativas.");
        return;
    }
    const summary = getSummarySeries();
    if (!summary || summary.columns.length < 2) {
        alert("Se necesitan al menos 2 meses para comparar.");
        return;
    }
    
    // Generar comparativa mes a mes
    let message = "📊 COMPARATIVA MES A MES\n\n";
    const { columns, netoMes, ingresos, egresos } = summary;
    
    for (let i = 1; i < columns.length; i++) {
        const prevLabel = formatMesDisplay(columns[i-1].year, columns[i-1].month);
        const currLabel = formatMesDisplay(columns[i].year, columns[i].month);
        const variacion = netoMes[i] - netoMes[i-1];
        const pct = netoMes[i-1] !== 0 ? ((variacion / Math.abs(netoMes[i-1])) * 100).toFixed(1) : 0;
        const signo = variacion >= 0 ? "↑" : "↓";
        message += `${prevLabel} → ${currLabel}: ${signo} ${formatCurrency(variacion)} (${pct}%)\n`;
    }
    
    alert(message);
}

function showTendenciaAnalysis() {
    if (state.filteredData.length === 0) {
        alert("Importa datos primero para ver tendencias.");
        return;
    }
    const summary = getSummarySeries();
    if (!summary) return;
    
    const { netoMes, ingresos, egresos } = summary;
    
    // Calcular tendencias simples
    const avgNeto = netoMes.reduce((a, b) => a + b, 0) / netoMes.length;
    const avgIngreso = ingresos.reduce((a, b) => a + b, 0) / ingresos.length;
    const avgEgreso = Math.abs(egresos.reduce((a, b) => a + b, 0) / egresos.length);
    
    // Tendencia (últimos 3 meses vs primeros 3)
    const len = netoMes.length;
    if (len >= 6) {
        const primeros = netoMes.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
        const ultimos = netoMes.slice(-3).reduce((a, b) => a + b, 0) / 3;
        const tendencia = ultimos > primeros ? "ALCISTA ↑" : ultimos < primeros ? "BAJISTA ↓" : "ESTABLE →";
        
        alert(`📈 ANÁLISIS DE TENDENCIA\n\n` +
            `Tendencia general: ${tendencia}\n` +
            `Promedio inicial (3 meses): ${formatCurrency(primeros)}\n` +
            `Promedio reciente (3 meses): ${formatCurrency(ultimos)}\n\n` +
            `Promedios del período:\n` +
            `• Flujo neto: ${formatCurrency(avgNeto)}\n` +
            `• Ingresos: ${formatCurrency(avgIngreso)}\n` +
            `• Egresos: ${formatCurrency(avgEgreso)}`);
    } else {
        alert(`📈 ANÁLISIS DE TENDENCIA\n\n` +
            `(Datos insuficientes para tendencia completa)\n\n` +
            `Promedios del período:\n` +
            `• Flujo neto: ${formatCurrency(avgNeto)}\n` +
            `• Ingresos: ${formatCurrency(avgIngreso)}\n` +
            `• Egresos: ${formatCurrency(avgEgreso)}`);
    }
}

function showProyeccionAnalysis() {
    if (state.filteredData.length === 0) {
        alert("Importa datos primero para ver proyecciones.");
        return;
    }
    const summary = getSummarySeries();
    if (!summary) return;
    
    const { columns, netoMes, saldoAcumulado, ingresos, egresos } = summary;
    
    // Proyección simple basada en promedio
    const avgNeto = netoMes.reduce((a, b) => a + b, 0) / netoMes.length;
    const lastSaldo = saldoAcumulado[saldoAcumulado.length - 1];
    
    let message = `🔮 PROYECCIÓN (basada en promedios)\n\n`;
    message += `Saldo actual: ${formatCurrency(lastSaldo)}\n`;
    message += `Flujo neto promedio: ${formatCurrency(avgNeto)}\n\n`;
    message += `Proyección próximos meses:\n`;
    
    for (let i = 1; i <= 3; i++) {
        const proyectado = lastSaldo + (avgNeto * i);
        message += `• +${i} mes${i > 1 ? 'es' : ''}: ${formatCurrency(proyectado)}\n`;
    }
    
    if (avgNeto < 0 && lastSaldo > 0) {
        const mesesHastaQuiebra = Math.ceil(lastSaldo / Math.abs(avgNeto));
        message += `\n⚠️ Con el flujo actual, el saldo se agotaría en ~${mesesHastaQuiebra} meses.`;
    }
    
    alert(message);
}

function showCategoriaAnalysis() {
    if (state.filteredData.length === 0) {
        alert("Importa datos primero para analizar categorías.");
        return;
    }
    
    const egresos = state.filteredData.filter(r => r.tipo === "02_Egreso");
    const grouped = groupByCategory(egresos);
    const total = grouped.reduce((acc, g) => acc + g.value, 0);
    
    let message = `📋 ANÁLISIS POR CATEGORÍA (Egresos)\n\n`;
    message += `Total egresos: ${formatCurrency(total)}\n\n`;
    message += `Top 5 categorías:\n`;
    
    grouped.slice(0, 5).forEach((cat, idx) => {
        const pct = ((cat.value / total) * 100).toFixed(1);
        message += `${idx + 1}. ${cat.label}: ${formatCurrency(cat.value)} (${pct}%)\n`;
    });
    
    alert(message);
}

function scrollToMesActual() {
    const wrapper = document.querySelector(".summary-table-wrapper");
    const targetCell = wrapper?.querySelector(".col-mes-actual");
    if (!wrapper || !targetCell) {
        alert("Define un mes actual para ubicarlo en el resumen.");
        return;
    }

    const offset = Math.max(0, targetCell.offsetLeft - wrapper.clientWidth / 2);
    wrapper.scrollTo({ left: offset, behavior: "smooth" });
    targetCell.classList.add("pulse-highlight");
    setTimeout(() => targetCell.classList.remove("pulse-highlight"), 1200);
}

// ===== FILTRADO =====
function applyFilters() {
    let data = state.rawData;

    if (state.currentEmpresa !== "all") {
        data = data.filter((r) => r.empresa === state.currentEmpresa);
    }

    // Filtro por rango de meses
    if (state.mesDesde) {
        data = data.filter((r) => r.mesKey >= state.mesDesde);
    }

    if (state.mesHasta) {
        data = data.filter((r) => r.mesKey <= state.mesHasta);
    }

    state.filteredData = data;

    // Actualizar headers dinámicos (sincronizan con el filtro de fechas)
    buildDynamicHeaders();
    
    // Render all views
    renderSummaryTable();
    renderMovementsTable();
    renderDashboard();
}

// ===== COLUMNAS DE MESES (dinámicas basadas en datos) =====
function getColumns() {
    if (state.meses.length === 0) return [];
    
    // Filtrar meses según filtros aplicados
    let mesesFiltrados = state.meses;
    if (state.mesDesde) {
        mesesFiltrados = mesesFiltrados.filter(m => m >= state.mesDesde);
    }
    if (state.mesHasta) {
        mesesFiltrados = mesesFiltrados.filter(m => m <= state.mesHasta);
    }
    
    return mesesFiltrados.map(mesKey => {
        const year = Math.floor(mesKey / 100);
        const month = (mesKey % 100) - 1;
        return { year, month, mesKey };
    });
}

function getSummarySeries() {
    const columns = getColumns();
    if (columns.length === 0) return null;

    const saldosIniciales = columns.map((col) => sumByType("00_Saldos", col.year, col.month));
    const ingresos = columns.map((col) => sumByType("01_Ingreso", col.year, col.month));
    const egresos = columns.map((col) => sumByType("02_Egreso", col.year, col.month));
    const movInternos = columns.map((col) => sumByType("03_Movimiento interno", col.year, col.month));

    const netoMes = columns.map((_, idx) => {
        if (state.currentEmpresa === "all") {
            return ingresos[idx] + egresos[idx];
        }
        return ingresos[idx] + egresos[idx] + movInternos[idx];
    });

    const saldoAcumulado = [];
    let acumulado = saldosIniciales[0] || 0;

    for (let i = 0; i < columns.length; i++) {
        if (i === 0) {
            acumulado = saldosIniciales[i] + netoMes[i];
        } else {
            acumulado += netoMes[i];
        }
        saldoAcumulado.push(acumulado);
    }

    return { columns, saldosIniciales, ingresos, egresos, movInternos, netoMes, saldoAcumulado };
}

// Obtener datos desde el inicio hasta el mes actual (para KPIs)
function getKPISeries() {
    if (state.meses.length === 0) return null;
    
    // Obtener todos los meses desde el inicio hasta el mes actual
    let mesesParaKPI = [...state.meses];
    
    // Si hay un mes actual definido, filtrar solo hasta ese mes
    if (state.mesActual) {
        mesesParaKPI = mesesParaKPI.filter(m => m <= state.mesActual);
    }
    
    if (mesesParaKPI.length === 0) return null;
    
    const columns = mesesParaKPI.map(mesKey => {
        const year = Math.floor(mesKey / 100);
        const month = (mesKey % 100) - 1;
        return { year, month, mesKey };
    });

    const saldosIniciales = columns.map((col) => sumByType("00_Saldos", col.year, col.month));
    const ingresos = columns.map((col) => sumByType("01_Ingreso", col.year, col.month));
    const egresos = columns.map((col) => sumByType("02_Egreso", col.year, col.month));
    const movInternos = columns.map((col) => sumByType("03_Movimiento interno", col.year, col.month));

    const netoMes = columns.map((_, idx) => {
        if (state.currentEmpresa === "all") {
            return ingresos[idx] + egresos[idx];
        }
        return ingresos[idx] + egresos[idx] + movInternos[idx];
    });

    const saldoAcumulado = [];
    let acumulado = saldosIniciales[0] || 0;

    for (let i = 0; i < columns.length; i++) {
        if (i === 0) {
            acumulado = saldosIniciales[i] + netoMes[i];
        } else {
            acumulado += netoMes[i];
        }
        saldoAcumulado.push(acumulado);
    }

    return { columns, saldosIniciales, ingresos, egresos, movInternos, netoMes, saldoAcumulado };
}

// ===== SUMMARY TABLE =====
function renderSummaryTable() {
    const tbody = document.getElementById("summaryBody");
    if (!tbody) return;

    const summary = getSummarySeries();
    if (!summary) {
        tbody.innerHTML = `<tr><td class="empty-message">Sin datos para mostrar</td></tr>`;
        return;
    }

    const { columns, saldosIniciales, ingresos, egresos, movInternos, netoMes, saldoAcumulado } = summary;
    
    // Función para determinar clase del mes actual
    const getMesActualClass = (idx) => {
        return state.mesActual && columns[idx].mesKey === state.mesActual ? " col-mes-actual" : "";
    };

    // Mostrar movimientos internos solo si no es vista "Consolidado"
    const movInternosRow = state.currentEmpresa !== "all" ? `
        <tr class="row-mov-interno">
            <td>03_Mov. Interno</td>
            ${movInternos.map((v, idx) => `<td class="${v < 0 ? "val-negative" : v > 0 ? "val-positive" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
    ` : "";

    tbody.innerHTML = `
        <tr class="row-saldo-inicial">
            <td><strong>Saldo inicial mes</strong></td>
            ${saldosIniciales.map((v, idx) => `<td class="${v < 0 ? "val-negative" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-ingreso">
            <td><strong>Ingresos</strong></td>
            ${ingresos.map((v, idx) => `<td class="${v < 0 ? "val-negative" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-egreso">
            <td><strong>Egresos</strong></td>
            ${egresos.map((v, idx) => `<td class="${v < 0 ? "val-negative" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
        ${movInternosRow}
        <tr class="row-saldo-mes">
            <td><strong>Saldo del mes</strong></td>
            ${netoMes.map((v, idx) => `<td class="${v < 0 ? "val-negative" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
        <tr class="row-saldo-acum">
            <td><strong>Saldo acumulado</strong></td>
            ${saldoAcumulado.map((v, idx) => `<td class="${v < 0 ? "val-negative" : ""}${getMesActualClass(idx)}">${formatNumber(v)}</td>`).join("")}
        </tr>
    `;
}

function sumByType(tipo, year, month) {
    return state.filteredData
        .filter((r) => r.tipo === tipo && r.year === year && r.month === month)
        .reduce((acc, r) => acc + r.valor, 0);
}

// ===== MOVEMENTS TABLE (AGRUPACIÓN MULTINIVEL) =====
function renderMovementsTable() {
    const tbody = document.getElementById("movementsBody");
    if (!tbody) return;

    const columns = getColumns();
    const data = state.filteredData;

    if (!data.length || columns.length === 0) {
        tbody.innerHTML = `<tr><td colspan="27">Sin datos para los filtros seleccionados</td></tr>`;
        return;
    }

    const { tipo: groupTipo, grupo: groupGrupo, categoria: groupCategoria } = state.groupLevels;
    
    // Construir estructura jerárquica
    const hierarchy = buildHierarchy(data, groupTipo, groupGrupo, groupCategoria);
    
    let html = "";
    let rowId = 0;

    hierarchy.forEach((tipoGroup) => {
        const tipoId = `row-${rowId++}`;
        const isEgreso = tipoGroup.label.includes("02_Egreso");
        
        if (groupTipo) {
            html += createHierarchyRow(tipoId, null, 0, tipoGroup.label, "", "", "", tipoGroup.totals, columns, tipoGroup.hasChildren, false);
        }

        tipoGroup.children.forEach((grupoGroup) => {
            const grupoId = `row-${rowId++}`;
            const grupoParent = groupTipo ? tipoId : null;
            const grupoLevel = groupTipo ? 1 : 0;

            if (groupGrupo) {
                html += createHierarchyRow(grupoId, grupoParent, grupoLevel, groupTipo ? "" : tipoGroup.label, grupoGroup.label, "", "", grupoGroup.totals, columns, grupoGroup.hasChildren, false);
            }

            grupoGroup.children.forEach((catGroup) => {
                const catId = `row-${rowId++}`;
                const catParent = groupGrupo ? grupoId : (groupTipo ? tipoId : null);
                let catLevel = 0;
                if (groupTipo) catLevel++;
                if (groupGrupo) catLevel++;

                if (groupCategoria) {
                    html += createHierarchyRow(catId, catParent, catLevel, 
                        (!groupTipo && !groupGrupo) ? tipoGroup.label : "", 
                        (!groupGrupo) ? grupoGroup.label : "", 
                        catGroup.label, "", catGroup.totals, columns, catGroup.hasChildren, isEgreso);
                }

                catGroup.children.forEach((subcat) => {
                    const subcatParent = groupCategoria ? catId : (groupGrupo ? grupoId : (groupTipo ? tipoId : null));
                    let subcatLevel = 0;
                    if (groupTipo) subcatLevel++;
                    if (groupGrupo) subcatLevel++;
                    if (groupCategoria) subcatLevel++;

                    html += createHierarchyRow(`row-${rowId++}`, subcatParent, subcatLevel,
                        (!groupTipo) ? tipoGroup.label : "",
                        (!groupGrupo) ? grupoGroup.label : "",
                        (!groupCategoria) ? catGroup.label : "",
                        subcat.label, subcat.totals, columns, false, false);
                });
            });
        });
    });

    tbody.innerHTML = html;
    setupRowExpanders();
}

function buildHierarchy(data, groupTipo, groupGrupo, groupCategoria) {
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
    const sortedTipos = Array.from(tipoMap.keys()).sort((a, b) => a.localeCompare(b));

    sortedTipos.forEach((tipoKey) => {
        const tipoRows = tipoMap.get(tipoKey);
        const tipoTotals = calcTotals(tipoRows, columns);
        
        // Agrupar por Grupo
        const grupoMap = new Map();
        tipoRows.forEach((row) => {
            if (!grupoMap.has(row.grupo)) {
                grupoMap.set(row.grupo, []);
            }
            grupoMap.get(row.grupo).push(row);
        });

        const grupoChildren = [];
        const sortedGrupos = Array.from(grupoMap.keys()).sort((a, b) => a.localeCompare(b));
        
        sortedGrupos.forEach((grupoKey) => {
            const grupoRows = grupoMap.get(grupoKey);
            const grupoTotals = calcTotals(grupoRows, columns);

            // Agrupar por Categoría
            const catMap = new Map();
            grupoRows.forEach((row) => {
                if (!catMap.has(row.categoria)) {
                    catMap.set(row.categoria, []);
                }
                catMap.get(row.categoria).push(row);
            });

            const catChildren = [];
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

            grupoChildren.push({
                label: grupoKey,
                totals: grupoTotals,
                children: catChildren,
                hasChildren: catChildren.length > 0
            });
        });

        result.push({
            label: tipoKey,
            totals: tipoTotals,
            children: grupoChildren,
            hasChildren: grupoChildren.length > 0
        });
    });

    return result;
}

function calcTotals(rows, columns) {
    return columns.map((col) => {
        return rows
            .filter((r) => r.year === col.year && r.month === col.month)
            .reduce((acc, r) => acc + r.valor, 0);
    });
}

function createHierarchyRow(id, parentId, level, tipo, grupo, categoria, subcategoria, totals, columns, hasChildren, isEgreso = false) {
    const parentAttr = parentId ? `data-parent="${parentId}"` : "";
    const hiddenClass = level >= 2 ? "row-hidden" : "";
    const collapsedClass = (level === 1 && hasChildren) ? "row-collapsed" : "";
    const expandIcon = hasChildren ? `<span class="expand-icon">▾</span>` : "";
    const egresoClass = (level === 2 && isEgreso) ? "row-egreso" : "";

    return `
        <tr class="row-level-${level} ${egresoClass} ${hiddenClass} ${collapsedClass}" data-id="${id}" data-level="${level}" ${parentAttr}>
            <td class="col-expand">${expandIcon}</td>
            <td class="col-tipo">${tipo}</td>
            <td class="col-grupo">${grupo}</td>
            <td class="col-categoria">${categoria}</td>
            <td class="col-subcategoria">${subcategoria}</td>
            ${totals.map((v, idx) => {
                const isNeg = v < 0;
                const firstYear = columns[0]?.year;
                const is2026 = columns[idx]?.year > firstYear;
                const isMesActual = state.mesActual && columns[idx]?.mesKey === state.mesActual;
                return `<td class="col-value ${isNeg ? "val-negative" : ""} ${is2026 ? "col-2026" : ""} ${isMesActual ? "col-mes-actual" : ""}">${v !== 0 ? formatNumber(v) : ""}</td>`;
            }).join("")}
        </tr>
    `;
}

function setupRowExpanders() {
    const tbody = document.getElementById("movementsBody");
    if (!tbody) return;

    const newTbody = tbody.cloneNode(true);
    tbody.parentNode.replaceChild(newTbody, tbody);

    newTbody.addEventListener("click", (e) => {
        const row = e.target.closest("tr[data-level]");
        if (!row) return;

        const expandIcon = row.querySelector(".expand-icon");
        if (!expandIcon) return;

        const rowId = row.dataset.id;
        const isCollapsed = row.classList.toggle("row-collapsed");

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
    renderNetFlowChart();
    renderDonutChart();
    renderHorizontalChart();
    renderParetoSection();
}

function renderKPIs() {
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };
    
    const setHtml = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = value;
    };

    // Usar datos según el modo seleccionado
    const kpiData = state.kpiUseFullRange ? getKPISeries() : getSummarySeries();
    if (!kpiData || state.filteredData.length === 0) {
        ["kpiIngresosValue", "kpiIngresosSub", "kpiEgresosValue", "kpiEgresosSub", "kpiNetoValue", "kpiNetoSub", "kpiSaldoValue", "kpiSaldoSub", "kpiMesesValue", "kpiMesesSub"].forEach((id, idx) => {
            setText(id, idx % 2 === 0 ? "-" : "");
        });
        return;
    }

    const { columns, ingresos, egresos, netoMes, saldoAcumulado, saldosIniciales } = kpiData;

    const totalIngresos = ingresos.reduce((acc, val) => acc + val, 0);
    const totalEgresos = egresos.reduce((acc, val) => acc + val, 0);
    const totalEgresosAbs = Math.abs(totalEgresos);
    const netoTotal = netoMes.reduce((acc, val) => acc + val, 0);
    const saldoInicial = saldosIniciales[0] || 0;
    const saldoFinal = saldoAcumulado[saldoAcumulado.length - 1] || 0;
    const mesesAnalizados = columns.length;
    const promedioIngresos = mesesAnalizados ? totalIngresos / mesesAnalizados : 0;
    const promedioEgresos = mesesAnalizados ? totalEgresosAbs / mesesAnalizados : 0;
    const cobertura = totalEgresosAbs === 0 ? null : totalIngresos / totalEgresosAbs;

    // Calcular meses reales vs proyectados
    let reales = mesesAnalizados;
    let proyectados = 0;
    if (state.mesActual) {
        const idx = columns.findIndex(col => col.mesKey === state.mesActual);
        if (idx >= 0) {
            reales = idx + 1;
            proyectados = Math.max(0, mesesAnalizados - reales);
        }
    }

    setText("kpiIngresosValue", formatCurrency(totalIngresos));
    setText("kpiIngresosSub", `Prom. mensual ${formatCurrency(promedioIngresos || 0)}`);
    setText("kpiEgresosValue", formatCurrency(totalEgresosAbs));
    setText("kpiEgresosSub", `Prom. mensual ${formatCurrency(promedioEgresos || 0)}`);
    setText("kpiNetoValue", formatCurrency(netoTotal));
    setText("kpiNetoSub", cobertura ? `Cobertura ${cobertura.toFixed(2)}x` : "Cobertura —");
    setText("kpiSaldoValue", formatCurrency(saldoFinal));
    setText("kpiSaldoSub", `Saldo inicial ${formatCurrency(saldoInicial)}`);
    setText("kpiMesesValue", `${mesesAnalizados} ${mesesAnalizados === 1 ? "mes" : "meses"}`);
    setText("kpiMesesSub", state.kpiUseFullRange ? `Inicio → Mes actual` : `Reales ${reales} · Proy. ${proyectados}`);
}

function formatVariation(pct, inverse = false) {
    if (pct === 0 || isNaN(pct)) return "";
    const isPositive = inverse ? pct < 0 : pct > 0;
    const icon = pct > 0 ? "fa-arrow-up" : "fa-arrow-down";
    const cssClass = isPositive ? "positive" : "negative";
    return `<span class="kpi-variation ${cssClass}"><i class="fa-solid ${icon}"></i> ${Math.abs(pct).toFixed(1)}%</span>`;
}

function formatCurrencyCompact(value) {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}MM`;
    if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `$${(value / 1e3).toFixed(0)}K`;
    return formatCurrency(value);
}

function renderAlerts(summary, cobertura, saldoFinal, netoMes, avgVariation) {
    const alertsList = document.getElementById("alertsList");
    const alertsCount = document.getElementById("alertsCount");
    if (!alertsList) return;
    
    const alerts = [];
    
    // Alerta: Cobertura baja
    if (cobertura !== null && cobertura < 1) {
        alerts.push({
            type: 'danger',
            icon: 'fa-circle-exclamation',
            message: `Cobertura crítica: los egresos superan a los ingresos (${cobertura.toFixed(2)}x)`
        });
    } else if (cobertura !== null && cobertura < 1.1) {
        alerts.push({
            type: 'warning',
            icon: 'fa-triangle-exclamation',
            message: `Cobertura ajustada: margen estrecho entre ingresos y egresos (${cobertura.toFixed(2)}x)`
        });
    }
    
    // Alerta: Saldo negativo
    if (saldoFinal < 0) {
        alerts.push({
            type: 'danger',
            icon: 'fa-circle-xmark',
            message: `Saldo acumulado negativo: ${formatCurrency(saldoFinal)}`
        });
    }
    
    // Alerta: Tendencia negativa
    if (avgVariation < -10) {
        alerts.push({
            type: 'warning',
            icon: 'fa-arrow-trend-down',
            message: `Tendencia negativa: variación promedio de ${avgVariation.toFixed(1)}%`
        });
    }
    
    // Alerta: Muchos meses negativos
    const negativeCount = netoMes.filter(n => n < 0).length;
    if (negativeCount > netoMes.length / 2) {
        alerts.push({
            type: 'warning',
            icon: 'fa-chart-line',
            message: `${negativeCount} de ${netoMes.length} meses con flujo negativo`
        });
    }
    
    // Alerta positiva: Buen rendimiento
    if (cobertura !== null && cobertura >= 1.2 && avgVariation >= 0) {
        alerts.push({
            type: 'success',
            icon: 'fa-circle-check',
            message: `Flujo saludable con cobertura de ${cobertura.toFixed(2)}x`
        });
    }
    
    // Información: Sin alertas críticas
    if (alerts.length === 0) {
        alerts.push({
            type: 'info',
            icon: 'fa-circle-info',
            message: 'Sin alertas críticas en el período analizado'
        });
    }
    
    alertsList.innerHTML = alerts.map(alert => `
        <div class="alert-item alert-${alert.type}">
            <i class="fa-solid ${alert.icon}"></i>
            <span>${alert.message}</span>
        </div>
    `).join('');
    
    if (alertsCount) {
        const criticalCount = alerts.filter(a => a.type === 'danger' || a.type === 'warning').length;
        alertsCount.textContent = criticalCount.toString();
    }
}

function renderLineChart() {
    const ctx = document.getElementById("lineChart");
    if (!ctx) return;
    destroyChart("line");

    const summary = getSummarySeries();
    if (!summary) return;

    const columns = summary.columns;
    const ingresos = summary.ingresos;
    const egresos = summary.egresos.map((value) => Math.abs(value));
    const saldoAcumulado = summary.saldoAcumulado;

    // Identificar índice del mes actual para distinguir real vs proyección
    let mesActualIdx = -1;
    if (state.mesActual) {
        mesActualIdx = columns.findIndex(c => c.mesKey === state.mesActual);
    }

    // Colores corporativos CRAMSA
    const colorIngresos = "#00a878";  // Verde éxito
    const colorEgresos = "#e63946";   // Rojo
    const colorSaldo = cramsaPalette.secondary;  // Azul CRAMSA

    const datasets = [
        {
            label: "Ingresos",
            data: ingresos,
            borderColor: colorIngresos,
            backgroundColor: 'rgba(0, 168, 120, 0.12)',
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 5,
            pointBackgroundColor: colorIngresos,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 7,
            yAxisID: 'y'
        },
        {
            label: "Egresos",
            data: egresos,
            borderColor: colorEgresos,
            backgroundColor: 'rgba(230, 57, 70, 0.12)',
            fill: true,
            tension: 0.4,
            borderWidth: 3,
            pointRadius: 5,
            pointBackgroundColor: colorEgresos,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 7,
            yAxisID: 'y'
        },
        {
            label: "Saldo Acumulado",
            data: saldoAcumulado,
            borderColor: colorSaldo,
            backgroundColor: 'rgba(0, 123, 165, 0.1)',
            fill: true,
            tension: 0.4,
            borderWidth: 3.5,
            borderDash: [],
            pointRadius: 6,
            pointBackgroundColor: colorSaldo,
            pointBorderColor: "#fff",
            pointBorderWidth: 2,
            pointHoverRadius: 8,
            yAxisID: 'y1'
        }
    ];

    state.charts.line = new Chart(ctx, {
        type: "line",
        data: {
            labels: columns.map((c) => `${monthLabels[c.month].substring(0, 3).toUpperCase()} ${String(c.year).slice(-2)}`),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.5,
            animation: false,
            resizeDelay: 100,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { 
                    position: "top", 
                    align: "end",
                    labels: { 
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 20, 
                        font: { size: 12, family: "'Plus Jakarta Sans', sans-serif", weight: '600' },
                        color: cramsaPalette.navy
                    } 
                },
                tooltip: {
                    backgroundColor: cramsaPalette.navy,
                    titleColor: '#fff',
                    bodyColor: '#e2e8f0',
                    padding: 14,
                    cornerRadius: 10,
                    titleFont: { size: 13, weight: '700', family: "'Plus Jakarta Sans', sans-serif" },
                    bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
                    bodySpacing: 8,
                    boxPadding: 6,
                    callbacks: { 
                        label: (ctx) => `  ${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                    }
                }
            },
            scales: {
                y: { 
                    type: 'linear',
                    position: 'left',
                    beginAtZero: true, 
                    grid: { color: 'rgba(19, 41, 75, 0.06)', drawBorder: false }, 
                    border: { display: false },
                    ticks: { 
                        callback: (v) => formatAxis(v), 
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.teal,
                        padding: 10
                    },
                    title: { 
                        display: true, 
                        text: 'Flujo mensual', 
                        font: { size: 11, weight: '600', family: "'Plus Jakarta Sans', sans-serif" },
                        color: cramsaPalette.navy
                    }
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    grid: { drawOnChartArea: false, drawBorder: false },
                    border: { display: false },
                    ticks: { 
                        callback: (v) => formatAxis(v), 
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.teal,
                        padding: 10
                    },
                    title: { 
                        display: true, 
                        text: 'Saldo acumulado', 
                        font: { size: 11, weight: '600', family: "'Plus Jakarta Sans', sans-serif" },
                        color: cramsaPalette.navy
                    }
                },
                x: { 
                    grid: { display: false, drawBorder: false }, 
                    border: { display: false },
                    ticks: { 
                        maxRotation: 0,
                        font: { size: 11, family: "'Plus Jakarta Sans', sans-serif", weight: '500' },
                        color: cramsaPalette.navy,
                        padding: 10
                    } 
                }
            }
        }
    });

    const badge = document.getElementById("lineChartBadge");
    if (badge) {
        const years = [...new Set(columns.map(c => c.year))].sort();
        badge.textContent = years.length > 1 ? `${years[0]}-${years[years.length-1]}` : years[0];
    }
}

function renderDonutChart() {
    const ctx = document.getElementById("donutChart");
    if (!ctx) return;
    destroyChart("donut");

    const incomes = state.filteredData.filter((r) => r.tipo === "01_Ingreso");
    const grouped = groupByCategory(incomes);

    if (grouped.length === 0) return;

    // Paleta de colores corporativa CRAMSA
    const colors = cramsaPalette.chartColors;

    state.charts.donut = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: grouped.map((g) => g.label),
            datasets: [{
                data: grouped.map((g) => g.value),
                backgroundColor: colors,
                borderWidth: 3,
                borderColor: '#fff',
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.2,
            animation: false,
            resizeDelay: 100,
            cutout: '65%',
            plugins: {
                legend: { 
                    position: "bottom", 
                    labels: { 
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 14, 
                        font: { size: 11, family: "'Plus Jakarta Sans', sans-serif", weight: '500' },
                        color: cramsaPalette.navy
                    } 
                },
                tooltip: {
                    backgroundColor: cramsaPalette.navy,
                    padding: 14,
                    cornerRadius: 10,
                    titleFont: { size: 12, weight: '700', family: "'Plus Jakarta Sans', sans-serif" },
                    bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
                    callbacks: {
                        label: (ctx) => {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((ctx.raw / total) * 100).toFixed(1);
                            return `${formatCurrency(ctx.raw)} (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

function renderNetFlowChart() {
    const ctx = document.getElementById("netFlowChart");
    if (!ctx) return;
    destroyChart("netFlow");

    const summary = getSummarySeries();
    if (!summary) return;

    const labels = summary.columns.map((col) => formatMesDisplay(col.year, col.month));
    const netSeries = summary.netoMes;
    const colors = netSeries.map((value) => value >= 0 ? "rgba(0, 168, 120, 0.7)" : "rgba(230, 57, 70, 0.75)");

    state.charts.netFlow = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "Flujo neto",
                data: netSeries,
                backgroundColor: colors,
                borderRadius: 8,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.5,
            animation: false,
            resizeDelay: 100,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: cramsaPalette.navy,
                    callbacks: {
                        label: (ctx) => formatCurrency(ctx.raw)
                    }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        font: { size: 11, family: "'Plus Jakarta Sans', sans-serif" },
                        color: cramsaPalette.navy
                    }
                },
                y: {
                    grid: { color: "rgba(19, 41, 75, 0.08)" },
                    ticks: {
                        callback: (val) => formatAxis(val),
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.tealDark
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

    // Determinar qué datos usar según el modo del switch KPI
    let egresos;
    if (state.kpiUseFullRange) {
        // Modo "Inicio → Mes actual": usar todos los datos (filtrados por empresa) desde el inicio hasta mes actual
        egresos = state.rawData.filter((r) => {
            const empresaMatch = state.currentEmpresa === "all" || r.empresa === state.currentEmpresa;
            const mesMatch = state.mesActual ? r.mesKey <= state.mesActual : true;
            return r.tipo === "02_Egreso" && empresaMatch && mesMatch;
        });
    } else {
        // Modo "Meses del rango": usar todo el rango seleccionado (incluyendo proyecciones si están en el rango)
        egresos = state.filteredData.filter((r) => r.tipo === "02_Egreso");
    }
    
    const grouped = groupByCategory(egresos).slice(0, 8);

    if (grouped.length === 0) return;

    // Colores degradados corporativos (del naranja CRAMSA al marrón)
    const colors = grouped.map((_, i) => {
        const intensity = 1 - (i * 0.08);
        return `rgba(230, 57, 70, ${intensity})`;
    });

    state.charts.horizontal = new Chart(ctx, {
        type: "bar",
        data: {
            labels: grouped.map((g) => g.label.length > 25 ? g.label.slice(0, 23) + '...' : g.label),
            datasets: [{
                data: grouped.map((g) => g.value),
                backgroundColor: colors,
                borderRadius: 6,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.2,
            animation: false,
            resizeDelay: 100,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: cramsaPalette.navy,
                    padding: 14,
                    cornerRadius: 10,
                    titleFont: { size: 12, weight: '700', family: "'Plus Jakarta Sans', sans-serif" },
                    bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
                    callbacks: {
                        title: (items) => grouped[items[0].dataIndex].label,
                        label: (ctx) => `Gasto: ${formatCurrency(-ctx.raw)}`
                    }
                }
            },
            scales: {
                x: { 
                    grid: { color: 'rgba(19, 41, 75, 0.06)', drawBorder: false },
                    border: { display: false },
                    ticks: { 
                        callback: (v) => formatAxis(v),
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.teal
                    } 
                },
                y: { 
                    grid: { display: false, drawBorder: false },
                    border: { display: false },
                    ticks: {
                        font: { size: 11, family: "'Plus Jakarta Sans', sans-serif", weight: '500' },
                        color: cramsaPalette.navy
                    }
                }
            }
        }
    });
}

function renderParetoSection() {
    const tbody = document.getElementById("paretoBody");
    const ctx = document.getElementById("paretoChart");
    if (!tbody || !ctx) return;

    // Determinar qué datos usar según el modo del switch KPI
    let egresos;
    if (state.kpiUseFullRange) {
        // Modo "Inicio → Mes actual": usar todos los datos (filtrados por empresa) desde el inicio hasta mes actual
        egresos = state.rawData.filter((r) => {
            const empresaMatch = state.currentEmpresa === "all" || r.empresa === state.currentEmpresa;
            const mesMatch = state.mesActual ? r.mesKey <= state.mesActual : true;
            return r.tipo === "02_Egreso" && empresaMatch && mesMatch;
        });
    } else {
        // Modo "Meses del rango": usar todo el rango seleccionado (incluyendo proyecciones si están en el rango)
        egresos = state.filteredData.filter((r) => r.tipo === "02_Egreso");
    }
    
    const grouped = groupByCategory(egresos);
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

    destroyChart("pareto");
    running = 0;
    const cumPercent = grouped.map((g) => {
        running += g.value;
        return (running / total) * 100;
    });

    // Colores sólidos para las barras del Pareto (degradado de intensidad)
    const paretoBarColors = grouped.map((_, i) => {
        const alpha = 1 - (i * 0.06);
        return `rgba(0, 87, 112, ${alpha})`; // cramsa-teal-dark con degradado de opacidad
    });

    state.charts.pareto = new Chart(ctx, {
        data: {
            labels: grouped.map((g) => g.label.length > 15 ? g.label.slice(0, 13) + '...' : g.label),
            datasets: [
                {
                    type: "line",
                    label: "% Acumulado",
                    data: cumPercent,
                    yAxisID: "y1",
                    borderColor: cramsaPalette.gold,
                    borderWidth: 3,
                    fill: false,
                    pointRadius: 5,
                    pointBackgroundColor: cramsaPalette.gold,
                    pointBorderColor: "#fff",
                    pointBorderWidth: 2,
                    tension: 0.3
                },
                {
                    type: "bar",
                    label: "Gasto por Categoría",
                    data: grouped.map((g) => g.value),
                    backgroundColor: paretoBarColors,
                    borderColor: cramsaPalette.tealDark,
                    borderWidth: 0,
                    borderRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 1.8,
            animation: false,
            resizeDelay: 100,
            interaction: { intersect: false, mode: 'index' },
            plugins: {
                legend: { 
                    position: "top", 
                    labels: { 
                        usePointStyle: true, 
                        padding: 18,
                        font: { size: 12, family: "'Plus Jakarta Sans', sans-serif", weight: '600' },
                        color: cramsaPalette.navy
                    } 
                },
                tooltip: {
                    backgroundColor: cramsaPalette.navy,
                    padding: 14,
                    cornerRadius: 10,
                    titleFont: { size: 12, weight: '700', family: "'Plus Jakarta Sans', sans-serif" },
                    bodyFont: { size: 12, family: "'JetBrains Mono', monospace" },
                    callbacks: {
                        title: (items) => grouped[items[0].dataIndex]?.label || '',
                        label: (ctx) => ctx.dataset.type === 'line' ? `Acumulado: ${ctx.raw.toFixed(1)}%` : `Gasto: ${formatCurrency(-ctx.raw)}`
                    }
                }
            },
            scales: {
                y: { 
                    grid: { color: 'rgba(19, 41, 75, 0.06)' }, 
                    ticks: { 
                        callback: (v) => formatAxis(v),
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.tealDark
                    } 
                },
                y1: { 
                    position: "right", 
                    grid: { drawOnChartArea: false }, 
                    ticks: { 
                        callback: (v) => `${v}%`,
                        font: { size: 11, family: "'JetBrains Mono', monospace" },
                        color: cramsaPalette.gold
                    }, 
                    max: 100 
                },
                x: { 
                    grid: { display: false }, 
                    ticks: { 
                        maxRotation: 90, 
                        minRotation: 45, 
                        autoSkip: false,
                        font: { size: 10, family: "'Plus Jakarta Sans', sans-serif" },
                        color: cramsaPalette.navy
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
        map.set(r.categoria, map.get(r.categoria) + Math.abs(r.valor));
    });
    return Array.from(map.entries())
        .map(([label, value]) => ({ label: removePrefix(label), value }))
        .sort((a, b) => b.value - a.value);
}

// Función auxiliar para eliminar prefijos "XX_" de las etiquetas
function removePrefix(str) {
    if (!str) return str;
    return str.replace(/^\d{2}_/, '');
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
    if (Math.abs(value) >= 1e9) return `${(value / 1e9).toFixed(1)} MM`;
    if (Math.abs(value) >= 1e6) return `${(value / 1e6).toFixed(1)} M`;
    if (Math.abs(value) >= 1e3) return `${(value / 1e3).toFixed(0)} K`;
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

    // Filtros por columna
    document.getElementById("filterDbAbono")?.addEventListener("input", debounce((e) => {
        state.db.filters.abono = e.target.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbEmpresa")?.addEventListener("change", (e) => {
        state.db.filters.empresa = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbTipo")?.addEventListener("change", (e) => {
        state.db.filters.tipo = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbGrupo")?.addEventListener("change", (e) => {
        state.db.filters.grupo = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbCategoria")?.addEventListener("change", (e) => {
        state.db.filters.categoria = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbSubcat")?.addEventListener("input", debounce((e) => {
        state.db.filters.subcategoria = e.target.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbCodigo")?.addEventListener("input", debounce((e) => {
        state.db.filters.codigo = e.target.value.toLowerCase();
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbMes")?.addEventListener("change", (e) => {
        state.db.filters.mes = e.target.value;
        state.db.currentPage = 1;
        renderDatabaseTable();
    });

    document.getElementById("filterDbValorMin")?.addEventListener("input", debounce((e) => {
        state.db.filters.valorMin = e.target.value ? parseFloat(e.target.value) : null;
        state.db.currentPage = 1;
        renderDatabaseTable();
    }, 300));

    document.getElementById("filterDbValorMax")?.addEventListener("input", debounce((e) => {
        state.db.filters.valorMax = e.target.value ? parseFloat(e.target.value) : null;
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

    setupBulkCheckboxes();
}

function setupBulkCheckboxes() {
    const fields = ["Empresa", "Tipo", "Grupo", "Categoria", "Subcategoria"];
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
    state.db.filters = {
        abono: "",
        empresa: "",
        tipo: "",
        grupo: "",
        categoria: "",
        subcategoria: "",
        codigo: "",
        mes: "",
        valorMin: null,
        valorMax: null
    };
    state.db.searchTerm = "";
    state.db.currentPage = 1;

    document.getElementById("dbSearch").value = "";
    document.getElementById("filterDbAbono").value = "";
    document.getElementById("filterDbEmpresa").value = "";
    document.getElementById("filterDbTipo").value = "";
    document.getElementById("filterDbGrupo").value = "";
    document.getElementById("filterDbCategoria").value = "";
    document.getElementById("filterDbSubcat").value = "";
    document.getElementById("filterDbCodigo").value = "";
    document.getElementById("filterDbMes").value = "";
    document.getElementById("filterDbValorMin").value = "";
    document.getElementById("filterDbValorMax").value = "";

    renderDatabaseTable();
}

function updateBulkEditButton() {
    const btn = document.getElementById("btnBulkEdit");
    if (btn) btn.disabled = state.db.selectedRows.size === 0;
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
        tbody.innerHTML = `<tr><td colspan="10" class="empty-message">Importe el archivo CSV para visualizar los datos</td></tr>`;
        updateDbStats();
        return;
    }

    populateDbFilterOptions();

    // Aplicar filtros
    let filtered = state.rawData;

    if (state.db.searchTerm) {
        filtered = filtered.filter((row) => {
            const searchStr = `${row.abono} ${row.empresa} ${row.tipo} ${row.grupo} ${row.categoria} ${row.subcategoria} ${row.codigo}`.toLowerCase();
            return searchStr.includes(state.db.searchTerm);
        });
    }

    const f = state.db.filters;
    if (f.abono) filtered = filtered.filter((r) => (r.abono || "").toLowerCase().includes(f.abono));
    if (f.empresa) filtered = filtered.filter((r) => r.empresa === f.empresa);
    if (f.tipo) filtered = filtered.filter((r) => r.tipo === f.tipo);
    if (f.grupo) filtered = filtered.filter((r) => r.grupo === f.grupo);
    if (f.categoria) filtered = filtered.filter((r) => r.categoria === f.categoria);
    if (f.subcategoria) filtered = filtered.filter((r) => (r.subcategoria || "").toLowerCase().includes(f.subcategoria));
    if (f.codigo) filtered = filtered.filter((r) => (r.codigo || "").toLowerCase().includes(f.codigo));
    if (f.mes) filtered = filtered.filter((r) => r.mes === f.mes);
    if (f.valorMin !== null) filtered = filtered.filter((r) => r.valor >= f.valorMin);
    if (f.valorMax !== null) filtered = filtered.filter((r) => r.valor <= f.valorMax);

    state.db.filteredData = filtered;

    // Paginación
    const pageSize = state.db.pageSize === "all" ? filtered.length : state.db.pageSize;
    const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    state.db.currentPage = Math.min(state.db.currentPage, totalPages);

    const startIdx = (state.db.currentPage - 1) * pageSize;
    const endIdx = startIdx + pageSize;
    const pageData = filtered.slice(startIdx, endIdx);

    const table = document.getElementById("dbTable");
    if (state.db.isEditMode) {
        table?.classList.remove("readonly-mode");
        table?.classList.add("edit-mode");
    } else {
        table?.classList.remove("edit-mode");
        table?.classList.add("readonly-mode");
    }

    let html = "";
    pageData.forEach((row) => {
        const globalIdx = state.rawData.indexOf(row);
        const isSelected = state.db.selectedRows.has(globalIdx);
        const valorClass = row.valor < 0 ? "val-negative" : row.valor > 0 ? "val-positive" : "";

        html += `
            <tr class="${isSelected ? "selected" : ""}" data-index="${globalIdx}">
                <td class="col-check"><input type="checkbox" data-index="${globalIdx}" ${isSelected ? "checked" : ""}></td>
                <td data-editable="true" data-field="abono" data-type="text" title="${row.abono || ""}">${truncateText(row.abono, 25) || "-"}</td>
                <td data-editable="true" data-field="empresa" data-type="text">${row.empresa || "-"}</td>
                <td data-editable="true" data-field="tipo" data-type="text">${row.tipo || "-"}</td>
                <td data-editable="true" data-field="grupo" data-type="text">${row.grupo || "-"}</td>
                <td data-editable="true" data-field="categoria" data-type="text">${row.categoria || "-"}</td>
                <td data-editable="true" data-field="subcategoria" data-type="text">${row.subcategoria || "-"}</td>
                <td data-editable="true" data-field="codigo" data-type="text">${row.codigo || "-"}</td>
                <td data-editable="true" data-field="mes" data-type="text">${row.mes || "-"}</td>
                <td data-editable="true" data-field="valor" data-type="number" class="${valorClass}">${formatCurrency(row.valor)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html || `<tr><td colspan="10" class="empty-message">No se encontraron resultados</td></tr>`;

    // Event listeners
    tbody.querySelectorAll("tr[data-index]").forEach((tr) => {
        const checkbox = tr.querySelector("input[type='checkbox']");
        
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

        tr.querySelectorAll("td[data-editable='true']").forEach((td) => {
            td.addEventListener("click", (e) => {
                e.stopPropagation();
                if (state.db.isEditMode) {
                    startInlineEdit(td, tr);
                }
            });
        });

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

    document.getElementById("dbPageInfo").textContent = `Página ${state.db.currentPage} de ${totalPages}`;
    document.getElementById("dbPrevPage").disabled = state.db.currentPage <= 1;
    document.getElementById("dbNextPage").disabled = state.db.currentPage >= totalPages;

    updateDbStats();
    updateBulkEditButton();
}

function populateDbFilterOptions() {
    const empresaSelect = document.getElementById("filterDbEmpresa");
    if (empresaSelect && empresaSelect.options.length <= 1) {
        const empresas = [...new Set(state.rawData.map((r) => r.empresa))].filter(Boolean);
        // Orden específico: CRAMSA - INFRA - GRUPO - ADD
        const empresaOrder = { "CRAMSA": 1, "INFRA": 2, "GRUPO": 3, "ADD": 4 };
        empresas.sort((a, b) => (empresaOrder[a] || 999) - (empresaOrder[b] || 999));
        empresas.forEach((e) => {
            empresaSelect.innerHTML += `<option value="${e}">${e}</option>`;
        });
    }

    const tipoSelect = document.getElementById("filterDbTipo");
    if (tipoSelect && tipoSelect.options.length <= 1) {
        const tipos = [...new Set(state.rawData.map((r) => r.tipo))].filter(Boolean).sort();
        tipos.forEach((t) => {
            tipoSelect.innerHTML += `<option value="${t}">${t}</option>`;
        });
    }

    const grupoSelect = document.getElementById("filterDbGrupo");
    if (grupoSelect && grupoSelect.options.length <= 1) {
        const grupos = [...new Set(state.rawData.map((r) => r.grupo))].filter(Boolean).sort();
        grupos.forEach((g) => {
            grupoSelect.innerHTML += `<option value="${g}">${g}</option>`;
        });
    }

    const catSelect = document.getElementById("filterDbCategoria");
    if (catSelect && catSelect.options.length <= 1) {
        const cats = [...new Set(state.rawData.map((r) => r.categoria))].filter(Boolean).sort();
        cats.forEach((c) => {
            catSelect.innerHTML += `<option value="${c}">${c}</option>`;
        });
    }

    const mesSelect = document.getElementById("filterDbMes");
    if (mesSelect && mesSelect.options.length <= 1) {
        const meses = [...new Set(state.rawData.map((r) => r.mes))].filter(Boolean).sort();
        meses.forEach((m) => {
            mesSelect.innerHTML += `<option value="${m}">${m}</option>`;
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
    document.getElementById("modalTitle").innerHTML = '<i class="fa-solid fa-file-pen"></i> Nuevo Registro';

    const defaultEmpresas = ["ADD", "CRAMSA", "INFRA", "GRUPO"];
    const defaultTipos = ["00_Saldos", "01_Ingreso", "02_Egreso", "03_Movimiento interno"];
    
    const empresas = state.rawData.length > 0 ? getUniqueValues("empresa") : defaultEmpresas;
    const tipos = state.rawData.length > 0 ? getUniqueValues("tipo") : defaultTipos;
    const grupos = state.rawData.length > 0 ? getUniqueValues("grupo") : ["-"];
    const categorias = state.rawData.length > 0 ? getUniqueValues("categoria") : ["Sin categoría"];
    const meses = state.rawData.length > 0 ? getUniqueValues("mes") : ["03-25"];

    populateSelect("editEmpresa", empresas, empresas[0]);
    populateSelect("editTipo", tipos, tipos[0]);
    populateSelect("editGrupo", grupos, grupos[0]);
    populateSelect("editCategoria", categorias, categorias[0]);
    populateSelect("editMes", meses, meses[0]);

    document.getElementById("editAbono").value = "";
    document.getElementById("editSubcategoria").value = "";
    document.getElementById("editCodigo").value = "";
    document.getElementById("editValor").value = "";

    document.getElementById("editModal").classList.add("active");
}

function openEditModal(index) {
    const row = state.rawData[index];
    if (!row) return;

    document.getElementById("editIndex").value = index;
    document.getElementById("modalTitle").innerHTML = '<i class="fa-solid fa-file-pen"></i> Editar Registro';

    populateSelect("editEmpresa", getUniqueValues("empresa"), row.empresa);
    populateSelect("editTipo", getUniqueValues("tipo"), row.tipo);
    populateSelect("editGrupo", getUniqueValues("grupo"), row.grupo);
    populateSelect("editCategoria", getUniqueValues("categoria"), row.categoria);
    populateSelect("editMes", getUniqueValues("mes"), row.mes);

    document.getElementById("editAbono").value = row.abono || "";
    document.getElementById("editSubcategoria").value = row.subcategoria || "";
    document.getElementById("editCodigo").value = row.codigo || "";
    document.getElementById("editValor").value = row.valor || 0;

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
        row = {};
    } else {
        if (!state.rawData[index]) return;
        row = state.rawData[index];
    }

    row.abono = document.getElementById("editAbono").value;
    row.empresa = document.getElementById("editEmpresa").value;
    row.tipo = document.getElementById("editTipo").value;
    row.grupo = document.getElementById("editGrupo").value;
    row.categoria = document.getElementById("editCategoria").value;
    row.subcategoria = document.getElementById("editSubcategoria").value;
    row.codigo = document.getElementById("editCodigo").value;
    row.mes = document.getElementById("editMes").value;
    row.valor = parseFloat(document.getElementById("editValor").value) || 0;

    // Parsear mes para obtener year y month
    const mesParsed = parseMes(row.mes);
    if (mesParsed) {
        row.year = mesParsed.year;
        row.month = mesParsed.month;
        row.mesKey = getMesKey(mesParsed.year, mesParsed.month);
    }

    if (isNewRecord) {
        state.rawData.push(row);
    }

    closeModal();
    
    extractFilterOptions();
    buildDynamicHeaders();
    buildEmpresaButtons();
    
    renderDatabaseTable();
    applyFilters();
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

    let dataToExport;
    if (state.db.selectedRows.size > 0) {
        dataToExport = state.rawData.filter((_, idx) => state.db.selectedRows.has(idx));
    } else if (state.db.filteredData.length < state.rawData.length) {
        dataToExport = state.db.filteredData;
    } else {
        dataToExport = state.rawData;
    }

    const headers = ["Abonos", "Empresa", "Tipo de movimiento", "Grupo", "Categoría", "Subcategoría", "Codigo", "Mes", "Valor"];
    const rows = dataToExport.map((row) => {
        return [
            row.abono,
            row.empresa,
            row.tipo,
            row.grupo,
            row.categoria,
            row.subcategoria,
            row.codigo,
            row.mes,
            row.valor
        ].map((val) => `"${(val || "").toString().replace(/"/g, '""')}"`).join(";");
    });

    const csvContent = "\uFEFF" + headers.join(";") + "\n" + rows.join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `Flujo_Caja_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
}

// ===== EDICIÓN MASIVA =====
function openBulkEditModal() {
    if (state.db.selectedRows.size === 0) {
        alert("Seleccione al menos un registro para editar");
        return;
    }

    document.getElementById("bulkCount").textContent = state.db.selectedRows.size;

    populateSelect("bulkEmpresa", getUniqueValues("empresa"), "");
    populateSelect("bulkTipo", getUniqueValues("tipo"), "");
    populateSelect("bulkGrupo", getUniqueValues("grupo"), "");
    populateSelect("bulkCategoria", getUniqueValues("categoria"), "");

    ["Empresa", "Tipo", "Grupo", "Categoria", "Subcategoria"].forEach((field) => {
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

    if (document.getElementById("bulkCheckEmpresa")?.checked) {
        changes.empresa = document.getElementById("bulkEmpresa").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckTipo")?.checked) {
        changes.tipo = document.getElementById("bulkTipo").value;
        hasChanges = true;
    }
    if (document.getElementById("bulkCheckGrupo")?.checked) {
        changes.grupo = document.getElementById("bulkGrupo").value;
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

    let count = 0;
    state.db.selectedRows.forEach((idx) => {
        const row = state.rawData[idx];
        if (row) {
            Object.assign(row, changes);
            count++;
        }
    });

    state.db.selectedRows.clear();
    document.getElementById("dbSelectAll").checked = false;

    closeBulkModal();
    
    renderDatabaseTable();
    applyFilters();
    saveToLocalStorage();

    alert(`Se actualizaron ${count} registros correctamente.`);
}

// ===== EDICIÓN INLINE =====
function startInlineEdit(td, tr) {
    if (td.classList.contains("editing")) return;

    const field = td.dataset.field;
    const type = td.dataset.type;
    const idx = parseInt(tr.dataset.index);
    const row = state.rawData[idx];
    if (!row) return;

    let currentValue;
    if (field === "valor") {
        currentValue = row.valor || 0;
    } else {
        currentValue = row[field] || "";
        if (currentValue === "-") currentValue = "";
    }

    const originalContent = td.innerHTML;

    let input;
    if (type === "number") {
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

    const saveInlineEdit = () => {
        const newValue = input.value;
        td.classList.remove("editing");

        if (field === "valor") {
            row.valor = parseFloat(newValue) || 0;
            td.innerHTML = formatCurrency(row.valor);
            td.className = "";
            td.dataset.editable = "true";
            td.dataset.field = "valor";
            td.dataset.type = "number";
            if (row.valor < 0) td.classList.add("val-negative");
            else if (row.valor > 0) td.classList.add("val-positive");
        } else if (field === "mes") {
            row.mes = newValue || "";
            const mesParsed = parseMes(row.mes);
            if (mesParsed) {
                row.year = mesParsed.year;
                row.month = mesParsed.month;
                row.mesKey = getMesKey(mesParsed.year, mesParsed.month);
            }
            td.innerHTML = newValue || "-";
        } else {
            row[field] = newValue || "";
            if (field === "abono") {
                td.innerHTML = truncateText(newValue, 25) || "-";
                td.title = newValue || "";
            } else {
                td.innerHTML = newValue || "-";
            }
        }

        saveToLocalStorage();
        extractFilterOptions();
        applyFilters();
    };

    const cancelInlineEdit = () => {
        td.classList.remove("editing");
        td.innerHTML = originalContent;
    };

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
