/* ============================================================
   Navigation Context Menu & Single Tab Logic
   ============================================================ */

'use strict';

function handleNavClick(event, moduleId) {
  if (event.ctrlKey || event.metaKey || event.shiftKey) {
    WorkspaceTabs.open(moduleId);
  }
  Router.navigate(moduleId);
}

function showNavMenu(event, moduleId) {
  event.preventDefault();
  event.stopPropagation();
  
  const isOpen = WorkspaceTabs.isOpen(moduleId);
  const isCurrent = Router.getCurrent() === moduleId;
  
  const menu = document.createElement('div');
  menu.className = 'nav-context-menu';
  menu.innerHTML = `
    <div class="nav-ctx-header">${getModuleLabel(moduleId)}</div>
    ${!isOpen ? `<button onclick="openInNewTab('${moduleId}')">Otwórz w karcie</button>` : ''}
    ${isOpen && !isCurrent ? `<button onclick="Router.navigate('${moduleId}')">Przejdź do karty</button>` : ''}
    ${isOpen ? `<button onclick="openInNewTab('${moduleId}')">Otwórz w nowej karcie</button>` : ''}
    ${isOpen ? `<div class="nav-ctx-sep"></div>` : ''}
    ${isOpen ? `<button onclick="WorkspaceTabs.close('${moduleId}'); hideNavMenu()" class="danger">Zamknij kartę</button>` : ''}
  `;
  
  document.body.appendChild(menu);
  
  const rect = event.currentTarget.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.left = `${rect.right + 8}px`;
  menu.style.top = `${rect.top}px`;
  menu.style.zIndex = '9999';
  
  menu.classList.add('open');
  
  const cleanup = () => {
    menu.remove();
    document.removeEventListener('click', cleanup);
    document.removeEventListener('contextmenu', cleanup);
  };
  
  setTimeout(() => document.addEventListener('click', cleanup), 10);
  document.addEventListener('contextmenu', cleanup);
}

function openInNewTab(moduleId) {
  WorkspaceTabs.open(moduleId);
  Router.navigate(moduleId);
  hideNavMenu();
}

function hideNavMenu() {
  document.querySelectorAll('.nav-context-menu').forEach(el => el.remove());
}

function getModuleLabel(moduleId) {
  const labels = {
    arkusz: 'Arkusz',
    zobowiazani: 'Szafka teczek', 
    ognivo: 'OGNIVO',
    wro: 'Analityka WRO',
    zakladka1: 'Wklepywator Excel',
    zakladka2: 'Rozliczenia', 
    zakladka3: 'Druk przelewu',
    zakladka4: 'Balanser'
  };
  return labels[moduleId] || moduleId;
}

// Dodaj toast helper jeśli nie istnieje
if (typeof showToast !== 'function') {
  window.showToast = function(msg, type = 'info') {
    console.log(`[${type}] ${msg}`);
  };
}