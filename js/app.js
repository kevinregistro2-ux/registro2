import {
  authErrorMessage, changePassword, deleteCurrentUserNow, loginUser, logoutUser,
  reauthenticate, registerUser, resetPassword, sendVerification, watchAuth
} from './auth.js';
import { applyTrustedDevicePreference, isTrustedDevice } from './firebase.js';
import {
  deleteOwnUserAccess, ensureUserAccess
} from './access.js';
import {
  deleteAllUserData, getSyncSnapshot, importBackup, loadAllMonths, loadConfig, loadConfigFromCache, loadMonth,
  loadMonthFromCache, makeBackup, queueArchiveCategory, queueArchivePlace, queueArchiveTemplate,
  queueArchiveType, queueCompleteActivity, queueFavoritePlace, queueFavoriteType, queueMoveActivity,
  queuePurgeActivity, queueReorderTemplates, queueRestoreActivity, queueSaveActivity, queueSaveCategory,
  queueSaveNotes, queueSavePlace, queueSaveTemplate, queueSaveType, queueTrashActivity, subscribeSync,
  validateBackup, waitForSync
} from './data.js';
import { PRIORITIES, STATUSES } from './constants.js';
import {
  $, $$, centsToInput, clearAuthMessage, closeModal, confirmAction, currentMonth, debounce,
  downloadText, endOfWeek, escapeHtml, formatDate, formatMonth, hashText, localDate, localTime,
  moneyFromCents, monthGrid, nextDate, normalizeSearch, openModal, parseCSV, parseMoneyToCents,
  setButtonBusy, setupConfirmModal, shiftMonth, showAuthMessage, startOfWeek, toast, toCSV
} from './ui.js';

const state={
  user:null,
  access:null,
  config:null,
  months:{},
  loadedServer:new Set(),
  activePage:'dashboard',

  placeTab:'active',
  typeTab:'active',
  categoryTab:'active',
  historyRange:null,

  calendarDay:null,
  pwaPrompt:null,
  lastHiddenAt:0,
  booted:false,
  reportYear:null,

  pendingAuthMessage:'',

  mobile:matchMedia('(max-width:850px)').matches
};

const emptyMonth=()=>({sv:5,mode:'single',parts:[],activities:{},partMap:{},exists:false});
const monthOf=date=>String(date||'').slice(0,7);
const activityList=month=>Object.entries(state.months[month]?.activities||{}).map(([id,a])=>({id,month,...a})).sort((a,b)=>`${b.d} ${b.t}`.localeCompare(`${a.d} ${a.t}`));
const visibleActivities=month=>activityList(month).filter(a=>!a.z);
const trashedActivities=month=>activityList(month).filter(a=>a.z);
const typeName=id=>state.config?.t?.[id]?.n||id||'Actividad archivada';
const typeIcon=id=>state.config?.t?.[id]?.i||'•';
const categoryName=id=>state.config?.c?.[id]?.n||id||'Sin categoría';
const placeName=id=>state.config?.p?.[id]?.n||'Lugar archivado';
const placeAddress=id=>state.config?.p?.[id]?.a||'';
const today=()=>localDate();

const MOBILE_BREAKPOINT=850;

const isMobileLayout=()=>matchMedia(`(max-width:${MOBILE_BREAKPOINT}px)`).matches;

const normalizedPath=()=>location.pathname.replace(/\/+$/,'')||'/';

const isAdminRoute=()=>normalizedPath()==='/admin';

function updateViewportState(){
  state.mobile=isMobileLayout();

  document.documentElement.dataset.device=state.mobile?'mobile':'desktop';
  document.documentElement.dataset.route=isAdminRoute()?'admin':'app';

  const height=window.visualViewport?.height||window.innerHeight;

  document.documentElement.style.setProperty(
    '--worklog-viewport-height',
    `${Math.round(height)}px`
  );

  if(!state.mobile){
    closeSidebar();
  }
}

function mobileFeedback(ms=10){
  if(state.mobile&&navigator.vibrate){
    navigator.vibrate(ms);
  }
}

function focusIntoView(target){
  if(!state.mobile||!target)return;

  setTimeout(()=>{
    target.scrollIntoView({
      block:'center',
      inline:'nearest',
      behavior:'smooth'
    });
  },180);
}

function cleanupLegacyCache(uid){
  const prefix=`worklog_v3_${uid}_`;

  Object.keys(localStorage)
    .filter(key=>key.startsWith(prefix))
    .forEach(key=>localStorage.removeItem(key));
}

function getActivePlaces(includeArchived=false){
  if(!state.config)return[];

  const usage=placeUsage();

  return Object.entries(state.config.p)
    .filter(([,p])=>includeArchived||!p.x)
    .map(([id,p])=>({id,...p}))
    .sort((a,b)=>{
      if(Boolean(b.f)!==Boolean(a.f)){
        return Number(b.f)-Number(a.f);
      }

      const diff=(usage[b.id]||0)-(usage[a.id]||0);

      if(diff)return diff;

      return a.n.localeCompare(b.n,'es');
    });
}

function getTypes(includeArchived=false){
  if(!state.config)return[];

  return Object.entries(state.config.t)
    .filter(([,t])=>includeArchived||!t.x)
    .map(([id,t])=>({id,...t}))
    .sort((a,b)=>{
      if(Boolean(b.f)!==Boolean(a.f)){
        return Number(b.f)-Number(a.f);
      }

      return a.n.localeCompare(b.n,'es');
    });
}

function getCategories(includeArchived=false){
  if(!state.config)return[];

  return Object.entries(state.config.c)
    .filter(([,c])=>includeArchived||!c.x)
    .map(([id,c])=>({id,...c}))
    .sort((a,b)=>a.n.localeCompare(b.n,'es'));
}

function getTemplates(includeArchived=false){
  if(!state.config)return[];

  return Object.entries(state.config.q)
    .filter(([,q])=>includeArchived||!q.x)
    .map(([id,q])=>({id,...q}))
    .sort((a,b)=>(a.o||0)-(b.o||0));
}

function loadedActivities(){
  return Object.keys(state.months)
    .flatMap(month=>visibleActivities(month));
}

function placeUsage(){
  const map={};

  loadedActivities().forEach(a=>{
    if(a.p){
      map[a.p]=(map[a.p]||0)+1;
    }
  });

  return map;
}

function suggestTypeForPlace(placeId){
  const counts={};

  loadedActivities()
    .filter(a=>a.p===placeId&&a.s!=='C')
    .forEach(a=>{
      counts[a.y]=(counts[a.y]||0)+1;
    });

  return Object.entries(counts)
    .sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
}

async function ensureMonth(month,{server=false}={}){
  if(!month)return emptyMonth();

  if(!state.months[month]){
    const cached=await loadMonthFromCache(state.user.uid,month);
    state.months[month]=cached||emptyMonth();
  }

  if(server&&!state.loadedServer.has(month)){
    try{
      state.months[month]=await loadMonth(state.user.uid,month);
      state.loadedServer.add(month);
    }catch(error){
      console.warn(error);
    }
  }

  return state.months[month];
}

async function syncConfigAndMonth(month=currentMonth()){
  if(!state.user)return false;

  if(!navigator.onLine){
    toast(
      'Estás sin conexión. Tus cambios locales se conservarán y se sincronizarán al volver Internet.',
      'error'
    );
    return false;
  }

  await waitForSync().catch(()=>false);

  const [config,monthState]=await Promise.all([
    loadConfig(state.user.uid),
    loadMonth(state.user.uid,month)
  ]);

  state.config=config;
  state.months[month]=monthState;
  state.loadedServer.add(month);

  renderCurrent();

  return true;
}

function openPage(page){
  const valid=[
    'dashboard',
    'agenda',
    'places',
    'history',
    'calendar',
    'reports',
    'settings'
  ];

  if(!valid.includes(page)){
    page='dashboard';
  }

  state.activePage=page;

  sessionStorage.setItem('worklog_active_page',page);

  $$('.page').forEach(p=>{
    p.classList.toggle('active',p.id===`page-${page}`);
  });

  $$('.nav-button').forEach(b=>{
    b.classList.toggle('active',b.dataset.page===page);
  });

  $$('.mobile-nav[data-page]').forEach(b=>{
    b.classList.toggle('active',b.dataset.page===page);
  });

  const titles={
    dashboard:'Inicio',
    agenda:'Jornada',
    places:'Lugares',
    history:'Historial',
    calendar:'Calendario',
    reports:'Reportes',
    settings:'Ajustes'
  };

  $('pageTitle').textContent=titles[page]||'WorkLog';

  closeSidebar();

  if(state.mobile){
    window.scrollTo({
      top:0,
      left:0,
      behavior:'auto'
    });
  }

  try{
    if(page==='dashboard'){
      renderDashboard();
    }

    if(page==='places'){
      renderPlaces();
    }

    if(page==='history'){
      void prepareHistory().catch(error=>{
        toast(
          error.message||'No se pudo cargar el historial.',
          'error'
        );
      });
    }

    if(page==='calendar'){
      void prepareCalendar().catch(error=>{
        toast(
          error.message||'No se pudo cargar el calendario.',
          'error'
        );
      });
    }

    if(page==='reports'){
      void prepareReports().catch(error=>{
        toast(
          error.message||'No se pudieron cargar los reportes.',
          'error'
        );
      });
    }

    if(page==='agenda'){
      void prepareAgenda().catch(error=>{
        toast(
          error.message||'No se pudo cargar la jornada.',
          'error'
        );
      });
    }

    if(page==='settings'){
      renderSettings();
    }

  }catch(error){
    console.error(error);

    toast(
      error.message||'No se pudo abrir esta sección.',
      'error'
    );
  }
}

function closeSidebar(){
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.add('hidden');
  document.body.classList.remove('sidebar-open');
}

function openSidebar(){
  if(!state.mobile)return;

  $('sidebar').classList.add('open');
  $('sidebarOverlay').classList.remove('hidden');
  document.body.classList.add('sidebar-open');

  mobileFeedback();
}

function preserveSelect(id,html,fallback=''){
  const el=$(id);

  if(!el)return;

  const old=el.value;

  el.innerHTML=html;

  if([...el.options].some(o=>o.value===old)){
    el.value=old;
  }else if(
    fallback&&
    [...el.options].some(o=>o.value===fallback)
  ){
    el.value=fallback;
  }
}

function placeOptions({
  includeAll=false,
  includeArchived=false
}={}){
  const list=getActivePlaces(includeArchived);

  return `${
    includeAll
      ?'<option value="">Todos los lugares</option>'
      :'<option value="">Seleccionar lugar...</option>'
  }`+
  list.map(p=>`
    <option value="${p.id}">
      ${escapeHtml(p.n)}
      ${p.a?' — '+escapeHtml(p.a):''}
    </option>
  `).join('');
}

function typeOptions({
  includeAll=false,
  includeArchived=false
}={}){
  const list=getTypes(includeArchived);

  return `${
    includeAll
      ?'<option value="">Todas las actividades</option>'
      :'<option value="">Seleccionar actividad...</option>'
  }`+
  list.map(t=>`
    <option value="${t.id}">
      ${escapeHtml(t.i)} ${escapeHtml(t.n)}
    </option>
  `).join('');
}

function categoryOptions({
  includeAll=false,
  includeArchived=false
}={}){
  const list=getCategories(includeArchived);

  return `${
    includeAll
      ?'<option value="">Todas las categorías</option>'
      :''
  }`+
  list.map(c=>`
    <option value="${c.id}">
      ${escapeHtml(c.i)} ${escapeHtml(c.n)}
    </option>
  `).join('');
}

function statusOptions(all=false){
  return `${
    all
      ?'<option value="">Todos los estados</option>'
      :''
  }`+
  Object.entries(STATUSES)
    .map(([id,n])=>`
      <option value="${id}">${n}</option>
    `)
    .join('');
}

function priorityOptions(all=false){
  return `${
    all
      ?'<option value="">Todas las prioridades</option>'
      :''
  }`+
  Object.entries(PRIORITIES)
    .map(([id,n])=>`
      <option value="${id}">${n}</option>
    `)
    .join('');
}

function fillAllSelects(){
  preserveSelect(
    'quickPlace',
    placeOptions()
  );

  preserveSelect(
    'activityPlace',
    placeOptions()
  );

  preserveSelect(
    'templatePlace',
    placeOptions()
  );

  preserveSelect(
    'quickType',
    typeOptions()
  );

  preserveSelect(
    'activityType',
    typeOptions()
  );

  preserveSelect(
    'templateType',
    typeOptions()
  );

  preserveSelect(
    'historyPlace',
    placeOptions({
      includeAll:true,
      includeArchived:true
    })
  );

  preserveSelect(
    'historyType',
    typeOptions({
      includeAll:true,
      includeArchived:true
    })
  );

  preserveSelect(
    'placeCategoryFilter',
    categoryOptions({
      includeAll:true,
      includeArchived:true
    })
  );

  preserveSelect(
    'placeCategory',
    categoryOptions()
  );

  preserveSelect(
    'historyStatus',
    statusOptions(true)
  );

  preserveSelect(
    'historyPriority',
    priorityOptions(true)
  );

  preserveSelect(
    'quickStatus',
    statusOptions(),
    'D'
  );

  preserveSelect(
    'activityStatus',
    statusOptions(),
    'D'
  );

  preserveSelect(
    'activityPriority',
    priorityOptions(),
    'M'
  );
}

function renderQuickNotes(){
  const notes=state.config?.n||[];

  const html=notes
    .map(note=>`
      <button
        type="button"
        class="note-chip"
        data-note="${escapeHtml(note)}"
      >
        ${escapeHtml(note)}
      </button>
    `)
    .join('');

  $('quickNoteChips').innerHTML=html;
  $('activityNoteChips').innerHTML=html;
}

function renderTemplates(){
  const templates=getTemplates()
    .filter(q=>
      state.config.p[q.p]&&
      !state.config.p[q.p].x&&
      state.config.t[q.y]&&
      !state.config.t[q.y].x
    );

  const usage=placeUsage();

  if(!templates.length){
    const fallback=getActivePlaces().slice(0,5);

    $('quickTemplates').innerHTML=fallback.length
      ?fallback.map(p=>`
        <button
          class="quick-template"
          data-fast-place="${p.id}"
        >
          <strong>
            ${p.f?'★ ':''}${escapeHtml(p.n)}
          </strong>
          <span>
            ${usage[p.id]||0} visitas cargadas
          </span>
        </button>
      `).join('')
      :`
        <div
          class="empty"
          style="width:100%"
        >
          Crea un lugar y luego una plantilla rápida.
        </div>
      `;

    return;
  }

  $('quickTemplates').innerHTML=templates
    .map(q=>`
      <button
        class="quick-template"
        draggable="${state.mobile?'false':'true'}"
        data-template="${q.id}"
      >
        <strong>
          ★ ${escapeHtml(q.n||placeName(q.p))}
        </strong>
        <span>
          ${escapeHtml(placeName(q.p))}
          ·
          ${escapeHtml(typeName(q.y))}
        </span>
      </button>
    `)
    .join('');
}

function renderStats(){
  const list=visibleActivities(currentMonth());

  const todays=list.filter(a=>a.d===today());

  $('statToday').textContent=todays.length;

  $('statPending').textContent=
    list.filter(a=>a.s==='P').length;

  $('statMonth').textContent=list.length;

  $('statAmount').textContent=
    moneyFromCents(
      list.reduce((s,a)=>s+a.v,0)
    );
}

function activityItem(a,{actions=false}={}){
  return `
    <div class="activity-item">

      <div class="activity-icon">
        ${escapeHtml(typeIcon(a.y))}
      </div>

      <div class="activity-main">
        <strong>
          ${escapeHtml(placeName(a.p))}
        </strong>

        <span>
          ${escapeHtml(typeName(a.y))}
          ·
          ${formatDate(a.d)}
          ${escapeHtml(a.t||'')}
          ${a.n?' · '+escapeHtml(a.n):''}
        </span>
      </div>

      <div class="activity-side">

        <strong>
          ${a.v?moneyFromCents(a.v):'—'}
        </strong>

        ${
          actions&&a.s==='P'
          ?`
            <button
              class="button button-small"
              data-complete="${a.month}|${a.id}"
            >
              ✓ Completar
            </button>
          `
          :`
            <span>
              ${escapeHtml(STATUSES[a.s]||'Realizado')}
            </span>
          `
        }

      </div>

    </div>
  `;
}

function renderRecent(){
  const list=
    visibleActivities(currentMonth())
      .slice(0,6);

  $('recentList').innerHTML=
    list.length
    ?list.map(a=>activityItem(a)).join('')
    :'<div class="empty">Aún no hay actividades este mes.</div>';
}

function renderPending(){
  const list=
    visibleActivities(currentMonth())
      .filter(a=>a.s==='P')
      .slice(0,6);

  $('pendingList').innerHTML=
    list.length
    ?list.map(a=>activityItem(a,{actions:true})).join('')
    :'<div class="empty">No tienes pendientes este mes.</div>';
}

function renderTimeline(){
  const list=
    visibleActivities(currentMonth())
      .filter(a=>a.d===today())
      .sort(
        (a,b)=>
          (a.t||'').localeCompare(b.t||'')
      );

  $('todayTimeline').innerHTML=
    list.length
    ?list.map(a=>`
      <div class="timeline-row">

        <div class="timeline-time">
          ${escapeHtml(a.t||'—')}
        </div>

        <div class="timeline-rail">
          <i class="timeline-dot"></i>
        </div>

        <div class="timeline-content">

          <strong>
            ${escapeHtml(placeName(a.p))}
          </strong>

          <span>
            ${escapeHtml(typeName(a.y))}
            ${a.v?' · '+moneyFromCents(a.v):''}
            ${a.n?' · '+escapeHtml(a.n):''}
          </span>

        </div>

      </div>
    `).join('')
    :'<div class="empty">Todavía no registras nada hoy.</div>';
}

function renderDashboard(){
  renderQuickNotes();
  renderTemplates();
  renderStats();
  renderRecent();
  renderPending();
  renderTimeline();
}

function showSkeleton(containerId,count=4){
  const el=$(containerId);

  if(!el)return;

  el.innerHTML=
    Array.from(
      {length:count},
      ()=>`
        <div
          class="skeleton"
          style="height:42px;margin-bottom:8px"
        ></div>
      `
    )
    .join('');
}

function renderPlaces(){
  const archived=
    state.placeTab==='archived';

  const q=
    normalizeSearch(
      $('placeSearch').value
    );

  const cat=
    $('placeCategoryFilter').value;

  const usage=
    placeUsage();

  const list=
    getActivePlaces(true)
      .filter(
        p=>Boolean(p.x)===archived
      )
      .filter(
        p=>
          (!cat||p.c===cat)&&
          normalizeSearch(
            [
              p.n,
              p.a,
              p.r,
              categoryName(p.c)
            ].join(' ')
          ).includes(q)
      );

  $('placesGrid').innerHTML=
    list.length
    ?list.map(p=>`
      <article class="place-card">

        <div class="place-top">

          <div>
            <h3>
              ${escapeHtml(p.n)}
            </h3>

            <p>
              ${escapeHtml(
                p.a||'Sin dirección guardada'
              )}
            </p>
          </div>

          ${
            !archived
            ?`
              <button
                class="star-button ${p.f?'active':''}"
                data-place-favorite="${p.id}"
              >
                ★
              </button>
            `
            :''
          }

        </div>

        <div class="chips">

          <span class="chip">
            ${escapeHtml(
              state.config.c[p.c]?.i||'•'
            )}
            ${escapeHtml(categoryName(p.c))}
          </span>

          <span class="chip">
            ${usage[p.id]||0} visitas cargadas
          </span>

          ${
            p.r
            ?`
              <span class="chip">
                ${escapeHtml(p.r)}
              </span>
            `
            :''
          }

        </div>

        <div class="place-actions">

          ${
            archived
            ?`
              <button
                class="button button-primary button-small"
                data-place-restore="${p.id}"
              >
                Restaurar
              </button>
            `
            :`
              <button
                class="button button-primary button-small"
                data-place-use="${p.id}"
              >
                Usar
              </button>

              <button
                class="button button-ghost button-small"
                data-place-edit="${p.id}"
              >
                Editar
              </button>

              <button
                class="button button-danger button-small"
                data-place-archive="${p.id}"
              >
                Archivar
              </button>
            `
          }

        </div>

      </article>
    `).join('')
    :`
      <div
        class="empty"
        style="grid-column:1/-1"
      >
        No hay lugares que coincidan.
      </div>
    `;
}

async function prepareAgenda(){
  const date=
    $('agendaDate').value||today();

  $('agendaDate').value=date;

  if(!state.months[monthOf(date)]){
    showSkeleton('agendaList',4);
  }

  await ensureMonth(
    monthOf(date),
    {server:true}
  );

  renderAgenda();
}

function agendaActivities(){
  const date=
    $('agendaDate').value||today();

  return visibleActivities(monthOf(date))
    .filter(a=>a.d===date)
    .sort(
      (a,b)=>
        (a.t||'').localeCompare(b.t||'')
    );
}

function renderAgenda(){
  const list=agendaActivities();

  const done=
    list.filter(a=>a.s==='D');

  const pending=
    list.filter(a=>a.s==='P');

  const places=
    new Set(list.map(a=>a.p));

  $('agendaProgress').textContent=
    `${done.length} / ${list.length}`;

  $('agendaDone').textContent=
    done.length;

  $('agendaPending').textContent=
    pending.length;

  $('agendaPlaces').textContent=
    places.size;

  $('agendaAmount').textContent=
    moneyFromCents(
      list.reduce((s,a)=>s+a.v,0)
    );

  $('agendaList').innerHTML=
    list.length
    ?list.map((a,index)=>`
      <div
        class="agenda-item ${a.s==='D'?'done':''}"
      >

        <div class="agenda-order">
          ${index+1}
        </div>

        <div class="agenda-main">

          <strong>
            ${escapeHtml(placeName(a.p))}
          </strong>

          <span>
            ${escapeHtml(a.t||'Sin hora')}
            ·
            ${escapeHtml(typeName(a.y))}
            ${
              a.du
              ?` · límite ${formatDate(a.du)}`
              :''
            }
          </span>

        </div>

        <div class="agenda-actions">

          ${
            a.s==='P'
            ?`
              <button
                class="button button-primary button-small"
                data-agenda-complete="${a.month}|${a.id}"
              >
                ✓
              </button>
            `
            :''
          }

          <button
            class="button button-ghost button-small"
            data-agenda-edit="${a.month}|${a.id}"
          >
            Editar
          </button>

        </div>

      </div>
    `).join('')
    :`
      <div class="empty">
        No hay paradas para este día.
        Agrega una actividad pendiente para planificar tu recorrido.
      </div>
    `;
}

function historyMonths(){
  if(!state.historyRange){
    return [
      $('historyMonth').value||
      currentMonth()
    ];
  }

  const months=[];

  let cursor=
    monthOf(state.historyRange.start);

  const end=
    monthOf(state.historyRange.end);

  while(cursor<=end){
    months.push(cursor);
    cursor=shiftMonth(cursor,1);
  }

  return months;
}

function historyActivities(){
  const q=
    normalizeSearch(
      $('historySearch').value
    );

  const day=
    $('historyDay').value;

  const from=
    $('historyFrom').value;

  const to=
    $('historyTo').value;

  const place=
    $('historyPlace').value;

  const type=
    $('historyType').value;

  const status=
    $('historyStatus').value;

  const priority=
    $('historyPriority').value;

  const money=
    $('historyMoney').value;

  let list=
    historyMonths()
      .flatMap(
        m=>visibleActivities(m)
      );

  if(state.historyRange){
    list=list.filter(
      a=>
        a.d>=state.historyRange.start&&
        a.d<=state.historyRange.end
    );
  }

  if(day){
    list=list.filter(a=>a.d===day);
  }

  if(from){
    list=list.filter(a=>a.d>=from);
  }

  if(to){
    list=list.filter(a=>a.d<=to);
  }

  if(place){
    list=list.filter(a=>a.p===place);
  }

  if(type){
    list=list.filter(a=>a.y===type);
  }

  if(status){
    list=list.filter(a=>a.s===status);
  }

  if(priority){
    list=list.filter(a=>a.pr===priority);
  }

  if(money==='yes'){
    list=list.filter(a=>a.v>0);
  }

  if(money==='no'){
    list=list.filter(a=>a.v===0);
  }

  if(q){
    list=list.filter(
      a=>
        normalizeSearch(
          [
            a.d,
            a.t,
            placeName(a.p),
            placeAddress(a.p),
            typeName(a.y),
            a.n,
            (a.g||[]).join(' '),
            STATUSES[a.s],
            PRIORITIES[a.pr],
            a.v/100
          ].join(' ')
        ).includes(q)
    );
  }

  return list.sort(
    (a,b)=>
      `${b.d} ${b.t}`
        .localeCompare(
          `${a.d} ${a.t}`
        )
  );
}

async function prepareHistory(){
  const month=
    $('historyMonth').value||
    currentMonth();

  $('historyMonth').value=month;

  if(!state.months[month]){
    $('historyBody').innerHTML=`
      <tr>
        <td colspan="9">
          <div
            class="skeleton"
            style="height:46px"
          ></div>
        </td>
      </tr>
    `;
  }

  await ensureMonth(
    month,
    {server:true}
  );

  fillAllSelects();

  renderHistory();
}

function renderHistory(){
  const list=historyActivities();

  $('historyBody').innerHTML=
    list.map(a=>`
      <tr>

        <td>
          ${formatDate(a.d)}
        </td>

        <td>
          ${escapeHtml(a.t||'—')}
        </td>

        <td>
          <strong>
            ${escapeHtml(placeName(a.p))}
          </strong>

          <span class="sub">
            ${escapeHtml(placeAddress(a.p))}
          </span>
        </td>

        <td>
          ${escapeHtml(typeIcon(a.y))}
          ${escapeHtml(typeName(a.y))}
        </td>

        <td>
          ${escapeHtml(a.n||'—')}

          ${
            a.g?.length
            ?`
              <div class="tag-list">
                ${
                  a.g.map(t=>`
                    <span class="tag">
                      ${escapeHtml(t)}
                    </span>
                  `).join('')
                }
              </div>
            `
            :''
          }
        </td>

        <td>
          <strong>
            ${a.v?moneyFromCents(a.v):'—'}
          </strong>
        </td>

        <td>
          <span class="status ${a.s}">
            ${escapeHtml(STATUSES[a.s])}
          </span>
        </td>

        <td>
          <span class="priority ${a.pr}">
            ${escapeHtml(PRIORITIES[a.pr])}
          </span>
        </td>

        <td>
          <div class="row-actions">

            <button
              class="button button-ghost button-small"
              data-history-repeat="${a.month}|${a.id}"
            >
              Repetir
            </button>

            <button
              class="button button-ghost button-small"
              data-history-edit="${a.month}|${a.id}"
            >
              Editar
            </button>

            <button
              class="button button-danger button-small"
              data-history-trash="${a.month}|${a.id}"
            >
              ✕
            </button>

          </div>
        </td>

      </tr>
    `).join('');

  $('historyEmpty').classList.toggle(
    'hidden',
    list.length>0
  );
}

async function prepareCalendar(){
  const month=
    $('calendarMonth').value||
    currentMonth();

  $('calendarMonth').value=month;

  if(!state.months[month]){
    $('calendarGrid').innerHTML=
      Array.from(
        {length:35},
        ()=>`
          <div
            class="skeleton"
            style="height:64px"
          ></div>
        `
      ).join('');
  }

  await ensureMonth(
    month,
    {server:true}
  );

  renderCalendar();
}

function renderCalendar(){
  const month=
    $('calendarMonth').value||
    currentMonth();

  $('calendarTitle').textContent=
    formatMonth(month);

  const counts={};

  visibleActivities(month)
    .forEach(a=>{
      counts[a.d]=(counts[a.d]||0)+1;
    });

  const max=
    Math.max(
      1,
      ...Object.values(counts)
    );

  $('calendarGrid').innerHTML=
    monthGrid(month)
      .map(cell=>{
        const count=
          counts[cell.date]||0;

        const heat=
          count
          ?Math.max(
            18,
            Math.round(count/max*75)
          )
          :0;

        return `
          <button
            class="
              calendar-day
              ${cell.outside?'outside':''}
              ${state.calendarDay===cell.date?'selected':''}
            "
            data-calendar-day="${cell.date}"
            style="--heat:${heat}%"
          >
            <span>
              ${Number(cell.date.slice(-2))}
            </span>

            ${
              count
              ?`
                <b class="day-count">
                  ${count}
                </b>
              `
              :''
            }
          </button>
        `;
      })
      .join('');

  if(state.calendarDay){
    renderCalendarDay(
      state.calendarDay
    );
  }else{
    $('calendarDayTitle').textContent=
      'Selecciona un día';

    $('calendarDaySubtitle').textContent=
      'Verás aquí sus actividades.';

    $('calendarDayList').innerHTML=
      '<div class="empty">Toca un día del calendario.</div>';
  }
}

function renderCalendarDay(date){
  const list=
    visibleActivities(monthOf(date))
      .filter(a=>a.d===date);

  $('calendarDayTitle').textContent=
    formatDate(
      date,
      {
        weekday:'long',
        day:'numeric',
        month:'long'
      }
    );

  $('calendarDaySubtitle').textContent=
    `${list.length} actividad${list.length===1?'':'es'}`;

  $('calendarDayList').innerHTML=
    list.length
    ?list.map(a=>activityItem(a)).join('')
    :'<div class="empty">No hay actividades en este día.</div>';
}

async function prepareReports(){
  const month=
    $('reportMonth').value||
    currentMonth();

  $('reportMonth').value=month;

  if(!state.months[month]){
    showSkeleton(
      'reportPlacesList',
      4
    );

    showSkeleton(
      'reportTypesList',
      4
    );
  }

  await ensureMonth(
    month,
    {server:true}
  );

  const prev=
    shiftMonth(month,-1);

  if(!state.months[prev]){
    const cached=
      await loadMonthFromCache(
        state.user.uid,
        prev
      );

    if(cached){
      state.months[prev]=cached;
    }
  }

  renderReports();
}

function reportRows(counts){
  const entries=
    Object.entries(counts)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,8);

  const max=
    entries[0]?.[1]||1;

  return entries.length
    ?entries.map(([name,count])=>`
      <div class="report-row">

        <div>

          <div class="report-label">
            <span>
              ${escapeHtml(name)}
            </span>

            <span>
              ${count}
            </span>
          </div>

          <div class="bar">
            <i
              style="
                width:${Math.max(6,count/max*100)}%
              "
            ></i>
          </div>

        </div>

        <b>
          ${count}
        </b>

      </div>
    `).join('')
    :'<div class="empty">No hay datos.</div>';
}

function longestStreak(dates){
  const unique=
    [...new Set(dates)].sort();

  let best=0;
  let current=0;
  let prev=null;

  for(const s of unique){
    const d=
      new Date(`${s}T12:00:00`);

    if(
      prev&&
      ((d-prev)/86400000===1)
    ){
      current++;
    }else{
      current=1;
    }

    best=
      Math.max(best,current);

    prev=d;
  }

  return best;
}

function renderReports(){
  const month=
    $('reportMonth').value||
    currentMonth();

  const list=
    visibleActivities(month);

  const days=
    new Set(
      list.map(a=>a.d)
    );

  $('reportActivities').textContent=
    list.length;

  $('reportPlaces').textContent=
    new Set(
      list.map(a=>a.p)
    ).size;

  $('reportDays').textContent=
    days.size;

  $('reportAmount').textContent=
    moneyFromCents(
      list.reduce((s,a)=>s+a.v,0)
    );

  const byPlace={};
  const byType={};
  const byStatus={};
  const byDay={};
  const byHour={};

  list.forEach(a=>{
    byPlace[placeName(a.p)]=
      (byPlace[placeName(a.p)]||0)+1;

    byType[typeName(a.y)]=
      (byType[typeName(a.y)]||0)+1;

    byStatus[STATUSES[a.s]]=
      (byStatus[STATUSES[a.s]]||0)+1;

    byDay[a.d]=
      (byDay[a.d]||0)+1;

    const h=
      (a.t||'').slice(0,2);

    if(h){
      byHour[h]=
        (byHour[h]||0)+1;
    }
  });

  $('reportPlacesList').innerHTML=
    reportRows(byPlace);

  $('reportTypesList').innerHTML=
    reportRows(byType);

  $('reportStatusList').innerHTML=
    reportRows(byStatus);

  const busiest=
    Object.entries(byDay)
      .sort((a,b)=>b[1]-a[1])[0];

  const commonHour=
    Object.entries(byHour)
      .sort((a,b)=>b[1]-a[1])[0];

  const prev=
    visibleActivities(
      shiftMonth(month,-1)
    );

  const diff=
    list.length-prev.length;

  const diffText=
    prev.length
    ?`${diff>=0?'+':''}${diff} vs. mes anterior`
    :'Sin comparación previa';

  const weekStart=
    startOfWeek();

  const weekEnd=
    endOfWeek();

  const weekList=
    loadedActivities()
      .filter(
        a=>
          a.d>=weekStart&&
          a.d<=weekEnd
      );

  const weekPlaces={};

  weekList.forEach(a=>{
    weekPlaces[placeName(a.p)]=
      (weekPlaces[placeName(a.p)]||0)+1;
  });

  const weekTop=
    Object.entries(weekPlaces)
      .sort((a,b)=>b[1]-a[1])[0];

  let yearHtml='';

  const year=
    month.slice(0,4);

  if(state.reportYear===year){
    const yearList=
      loadedActivities()
        .filter(
          a=>a.d.startsWith(year+'-')
        );

    const yearPlaces={};

    yearList.forEach(a=>{
      yearPlaces[placeName(a.p)]=
        (yearPlaces[placeName(a.p)]||0)+1;
    });

    const yearTop=
      Object.entries(yearPlaces)
        .sort((a,b)=>b[1]-a[1])[0];

    yearHtml=`
      <div class="indicator-row">
        <div>
          <strong>
            Resumen ${year}
          </strong>
          <span>
            Meses del año cargados bajo demanda
          </span>
        </div>
        <b>
          ${yearList.length} act.
        </b>
      </div>

      <div class="indicator-row">
        <div>
          <strong>
            Lugar principal del año
          </strong>
          <span>
            ${escapeHtml(yearTop?.[0]||'—')}
          </span>
        </div>
        <b>
          ${yearTop?.[1]||0}
        </b>
      </div>
    `;
  }

  $('reportIndicators').innerHTML=`
    <div class="indicator-row">
      <div>
        <strong>
          Promedio por día activo
        </strong>
        <span>
          Actividades / días con registro
        </span>
      </div>
      <b>
        ${
          days.size
          ?(list.length/days.size).toFixed(1)
          :'0'
        }
      </b>
    </div>

    <div class="indicator-row">
      <div>
        <strong>
          Día con más actividad
        </strong>
        <span>
          ${busiest?formatDate(busiest[0]):'—'}
        </span>
      </div>
      <b>
        ${busiest?.[1]||0}
      </b>
    </div>

    <div class="indicator-row">
      <div>
        <strong>
          Hora más frecuente
        </strong>
        <span>
          Según los registros del mes
        </span>
      </div>
      <b>
        ${
          commonHour
          ?commonHour[0]+':00'
          :'—'
        }
      </b>
    </div>

    <div class="indicator-row">
      <div>
        <strong>
          Racha máxima
        </strong>
        <span>
          Días consecutivos con actividad
        </span>
      </div>
      <b>
        ${longestStreak([...days])}
      </b>
    </div>

    <div class="indicator-row">
      <div>
        <strong>
          Esta semana
        </strong>
        <span>
          ${escapeHtml(weekTop?.[0]||'Sin actividad')}
        </span>
      </div>
      <b>
        ${weekList.length} act.
      </b>
    </div>

    <div class="indicator-row">
      <div>
        <strong>
          Comparación mensual
        </strong>
        <span>
          ${escapeHtml(diffText)}
        </span>
      </div>
      <b>
        ${
          prev.length
          ?Math.round(
            (list.length-prev.length)/
            prev.length*
            100
          )+'%'
          :'—'
        }
      </b>
    </div>

    ${yearHtml}
  `;
}

function renderManagers(){
  const typeArchived=
    state.typeTab==='archived';

  const types=
    getTypes(true)
      .filter(
        t=>Boolean(t.x)===typeArchived
      );

  $('typesManager').innerHTML=
    types.length
    ?types.map(t=>`
      <div class="manager-item">

        <div class="manager-item-main">
          <strong>
            ${escapeHtml(t.i)}
            ${escapeHtml(t.n)}
          </strong>

          <span>
            ${t.f?'Favorita · ':''}
            ${t.x?'Archivada':'Disponible'}
          </span>
        </div>

        <div class="manager-actions">

          ${
            t.x
            ?`
              <button
                class="button button-primary button-small"
                data-type-restore="${t.id}"
              >
                Restaurar
              </button>
            `
            :`
              <button
                class="button button-ghost button-small"
                data-type-favorite="${t.id}"
              >
                ${t.f?'★':'☆'}
              </button>

              <button
                class="button button-ghost button-small"
                data-type-edit="${t.id}"
              >
                Editar
              </button>

              <button
                class="button button-danger button-small"
                data-type-archive="${t.id}"
              >
                Archivar
              </button>
            `
          }

        </div>
      </div>
    `).join('')
    :'<div class="empty">No hay tipos en esta sección.</div>';

  const catArchived=
    state.categoryTab==='archived';

  const cats=
    getCategories(true)
      .filter(
        c=>Boolean(c.x)===catArchived
      );

  $('categoriesManager').innerHTML=
    cats.length
    ?cats.map(c=>`
      <div class="manager-item">

        <div class="manager-item-main">
          <strong>
            ${escapeHtml(c.i)}
            ${escapeHtml(c.n)}
          </strong>

          <span>
            ${c.x?'Archivada':'Disponible'}
          </span>
        </div>

        <div class="manager-actions">

          ${
            c.x
            ?`
              <button
                class="button button-primary button-small"
                data-category-restore="${c.id}"
              >
                Restaurar
              </button>
            `
            :`
              <button
                class="button button-ghost button-small"
                data-category-edit="${c.id}"
              >
                Editar
              </button>

              <button
                class="button button-danger button-small"
                data-category-archive="${c.id}"
              >
                Archivar
              </button>
            `
          }

        </div>

      </div>
    `).join('')
    :'<div class="empty">No hay categorías en esta sección.</div>';

  const templates=
    getTemplates(true)
      .filter(q=>!q.x);

  $('templatesManager').innerHTML=
    templates.length
    ?templates.map((q,index)=>`
      <div
        class="manager-item"
        draggable="${state.mobile?'false':'true'}"
        data-template-manager="${q.id}"
      >

        <div class="manager-item-main">

          <strong>
            ${
              escapeHtml(
                q.n||
                placeName(q.p)+
                ' · '+
                typeName(q.y)
              )
            }
          </strong>

          <span>
            ${escapeHtml(placeName(q.p))}
            ·
            ${escapeHtml(typeName(q.y))}
            ${q.note?' · '+escapeHtml(q.note):''}
          </span>

        </div>

        <div class="manager-actions">

          <button
            class="button button-ghost button-small"
            data-template-up="${q.id}"
            ${index===0?'disabled':''}
          >
            ↑
          </button>

          <button
            class="button button-ghost button-small"
            data-template-down="${q.id}"
            ${index===templates.length-1?'disabled':''}
          >
            ↓
          </button>

          <button
            class="button button-ghost button-small"
            data-template-edit="${q.id}"
          >
            Editar
          </button>

          <button
            class="button button-danger button-small"
            data-template-archive="${q.id}"
          >
            ✕
          </button>

        </div>

      </div>
    `).join('')
    :'<div class="empty">No hay plantillas rápidas.</div>';

  const notes=
    state.config?.n||[];

  $('notesManager').innerHTML=
    notes.length
    ?notes.map((n,i)=>`
      <div class="manager-item">

        <div class="manager-item-main">

          <strong>
            ${escapeHtml(n)}
          </strong>

          <span>
            Nota rápida
          </span>

        </div>

        <button
          class="button button-danger button-small"
          data-note-remove="${i}"
        >
          Eliminar
        </button>

      </div>
    `).join('')
    :'<div class="empty">No hay notas rápidas.</div>';
}

function renderTrash(){
  const month=currentMonth();

  const list=
    trashedActivities(month);

  $('trashManager').innerHTML=
    list.length
    ?list.map(a=>`
      <div class="manager-item">

        <div class="manager-item-main">

          <strong>
            ${escapeHtml(placeName(a.p))}
            ·
            ${escapeHtml(typeName(a.y))}
          </strong>

          <span>
            ${formatDate(a.d)}
            · eliminado
            ${
              a.zd
              ?new Date(a.zd).toLocaleString('es-EC')
              :'recientemente'
            }
          </span>

        </div>

        <div class="manager-actions">

          <button
            class="button button-primary button-small"
            data-trash-restore="${a.month}|${a.id}"
          >
            Restaurar
          </button>

          <button
            class="button button-danger button-small"
            data-trash-purge="${a.month}|${a.id}"
          >
            Purgar
          </button>

        </div>

      </div>
    `).join('')
    :'<div class="empty">La papelera del mes actual está vacía.</div>';
}

function applyPreferenceUI(){
  const mode=
    localStorage.getItem('worklog_theme')||
    'auto';

  $$('[data-theme-mode]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.themeMode===mode
    );
  });

  const accent=
    localStorage.getItem('worklog_accent')||
    'violet';

  $$('[data-accent]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.accent===accent
    );
  });

  const density=
    localStorage.getItem('worklog_density')||
    'comfortable';

  $$('[data-density]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.density===density
    );
  });

  $('trustedDeviceToggle').checked=
    isTrustedDevice();

  $('pinStatusText').textContent=
    localStorage.getItem('worklog_pin_hash')
      ?'Configurado en este dispositivo.'
      :'No configurado.';

  $('pinManageBtn').textContent=
    localStorage.getItem('worklog_pin_hash')
      ?'Cambiar'
      :'Configurar';

  $('removePinBtn').classList.toggle(
    'hidden',
    !localStorage.getItem('worklog_pin_hash')
  );

  $('pinTimeoutSelect').value=
    localStorage.getItem('worklog_pin_timeout')||
    '5';
}

function renderSettings(){
  renderManagers();
  renderTrash();
  applyPreferenceUI();

  const u=state.user;

  $('settingsEmail').textContent=
    u?.email||'—';

  $('emailVerifiedBadge').textContent=
    u?.emailVerified
      ?'✓ Verificado'
      :'Pendiente';

  $('verifyEmailBtn').disabled=
    Boolean(u?.emailVerified);
}

function renderCurrent(){
  fillAllSelects();

  if(state.activePage==='dashboard'){
    renderDashboard();
  }

  if(state.activePage==='agenda'){
    renderAgenda();
  }

  if(state.activePage==='places'){
    renderPlaces();
  }

  if(state.activePage==='history'){
    renderHistory();
  }

  if(state.activePage==='calendar'){
    renderCalendar();
  }

  if(state.activePage==='reports'){
    renderReports();
  }

  if(state.activePage==='settings'){
    renderSettings();
  }
}

function renderCore(){
  renderCurrent();
}

function findActivity(month,id){
  const a=
    state.months[month]
      ?.activities
      ?.[id];

  return a
    ?{
      id,
      month,
      ...a
    }
    :null;
}

function openPlaceEditor(id=null){
  $('placeForm').reset();

  $('placeId').value='';

  $('placeModalTitle').textContent=
    'Nuevo lugar';

  fillAllSelects();

  if(id){
    const p=
      state.config.p[id];

    if(!p)return;

    $('placeId').value=id;

    $('placeModalTitle').textContent=
      'Editar lugar';

    $('placeName').value=p.n;
    $('placeAddress').value=p.a;
    $('placeCategory').value=p.c;
    $('placeReference').value=p.r;
  }

  openModal('placeModal');
}

function openTypeEditor(id=null){
  $('typeForm').reset();

  $('typeId').value='';

  $('typeModalTitle').textContent=
    'Nuevo tipo de actividad';

  if(id){
    const t=
      state.config.t[id];

    if(!t)return;

    $('typeId').value=id;

    $('typeModalTitle').textContent=
      'Editar tipo de actividad';

    $('typeName').value=t.n;
    $('typeIcon').value=t.i;
    $('typeFavorite').checked=t.f;
  }

  openModal('typeModal');
}

function openCategoryEditor(id=null){
  $('categoryForm').reset();

  $('categoryId').value='';

  $('categoryModalTitle').textContent=
    'Nueva categoría';

  if(id){
    const c=
      state.config.c[id];

    if(!c)return;

    $('categoryId').value=id;

    $('categoryModalTitle').textContent=
      'Editar categoría';

    $('categoryName').value=c.n;
    $('categoryIcon').value=c.i;
  }

  openModal('categoryModal');
}

function openTemplateEditor(id=null){
  $('templateForm').reset();

  $('templateId').value='';

  $('templateModalTitle').textContent=
    'Nueva plantilla';

  fillAllSelects();

  if(id){
    const q=
      state.config.q[id];

    if(!q)return;

    $('templateId').value=id;

    $('templateModalTitle').textContent=
      'Editar plantilla';

    $('templateName').value=q.n;
    $('templatePlace').value=q.p;
    $('templateType').value=q.y;
    $('templateNote').value=q.note;
  }

  openModal('templateModal');
}

function setSuggestedTypeForPlace(
  placeId,
  selectId,
  force=false
){
  const suggestion=
    suggestTypeForPlace(placeId);

  const select=
    $(selectId);

  if(
    suggestion&&
    (force||!select.value)
  ){
    select.value=suggestion;
  }

  if(selectId==='activityType'){
    $('activitySuggestion').textContent=
      suggestion
      ?`Sugerencia basada en tus registros cargados: ${typeName(suggestion)}.`
      :'';
  }
}

function openActivityEditor({
  month=null,
  id=null,
  placeId='',
  date=null,
  status='D',
  repeat=false
}={}){
  $('activityForm').reset();

  $('activityId').value='';
  $('activityOriginalMonth').value='';

  $('activityModalTitle').textContent=
    id
      ?'Editar actividad'
      :repeat
        ?'Repetir actividad'
        :'Nueva actividad';

  $('activityDate').value=
    date||today();

  $('activityTime').value=
    localTime();

  $('activityStatus').value=
    status;

  $('activityPriority').value=
    'M';

  fillAllSelects();

  if(placeId){
    $('activityPlace').value=
      placeId;

    setSuggestedTypeForPlace(
      placeId,
      'activityType',
      true
    );
  }

  if(id&&month){
    const a=
      findActivity(month,id);

    if(!a)return;

    $('activityId').value=id;
    $('activityOriginalMonth').value=month;
    $('activityPlace').value=a.p;

    $('activityDate').value=
      repeat?today():a.d;

    $('activityTime').value=
      repeat?localTime():a.t;

    $('activityType').value=a.y;

    $('activityValue').value=
      repeat
      ?''
      :centsToInput(a.v);

    $('activityStatus').value=
      repeat
      ?'D'
      :a.s;

    $('activityPriority').value=
      a.pr;

    $('activityDueDate').value=
      repeat
      ?''
      :a.du;

    $('activityNote').value=
      a.n;

    $('activityTags').value=
      (a.g||[]).join(', ');
  }

  renderQuickNotes();

  openModal('activityModal');

  mobileFeedback();

  focusIntoView(
    placeId
      ?$('activityType')
      :$('activityPlace')
  );
}

function lastActivity(){
  return Object.keys(state.months)
    .flatMap(m=>visibleActivities(m))
    .sort(
      (a,b)=>
        `${b.d} ${b.t}`
          .localeCompare(
            `${a.d} ${a.t}`
          )
    )[0]||null;
}

function duplicateActivity(
  month,
  activity,
  excludeId=''
){
  return visibleActivities(month)
    .find(
      a=>
        a.id!==excludeId&&
        a.d===activity.date&&
        a.t===activity.time&&
        a.p===activity.placeId&&
        a.y===activity.typeId
    );
}

function activityFromForm(
  prefix='activity'
){
  const modal=
    prefix==='activity';

  const tags=
    modal
    ?$('activityTags')
      .value
      .split(',')
      .map(v=>v.trim())
      .filter(Boolean)
      .slice(0,12)
    :[];

  return {
    date:
      modal
      ?$('activityDate').value
      :today(),

    time:
      modal
      ?$('activityTime').value
      :localTime(),

    placeId:
      $(
        modal
          ?'activityPlace'
          :'quickPlace'
      ).value,

    typeId:
      $(
        modal
          ?'activityType'
          :'quickType'
      ).value,

    valueCents:
      parseMoneyToCents(
        $(
          modal
            ?'activityValue'
            :'quickValue'
        ).value
      ),

    status:
      $(
        modal
          ?'activityStatus'
          :'quickStatus'
      ).value,

    priority:
      modal
      ?$('activityPriority').value
      :'M',

    dueDate:
      modal
      ?$('activityDueDate').value
      :'',

    note:
      $(
        modal
          ?'activityNote'
          :'quickNote'
      ).value.trim(),

    tags,

    deleted:false,

    deletedAt:''
  };
}

async function saveActivityOptimistic(
  activity,
  {
    id=null,
    originalMonth=null
  }={}
){
  if(
    !activity.placeId||
    !activity.typeId
  ){
    throw new Error(
      'Selecciona un lugar y una actividad.'
    );
  }

  const targetMonth=
    monthOf(activity.date);

  let target=
    state.months[targetMonth];

  if(!target){
    if(
      state.config.m.includes(targetMonth)
    ){
      target=
        await ensureMonth(
          targetMonth,
          {server:true}
        );
    }else{
      target=
        state.months[targetMonth]=
          emptyMonth();
    }
  }

  const duplicate=
    duplicateActivity(
      targetMonth,
      activity,
      id||''
    );

  if(duplicate){
    const ok=
      await confirmAction(
        'Posible duplicado',
        `Ya existe una actividad igual a las ${activity.time} en ${placeName(activity.placeId)}. ¿Guardar de todos modos?`,
        {
          danger:false,
          okLabel:'Guardar igualmente'
        }
      );

    if(!ok)return false;
  }

  if(
    id&&
    originalMonth&&
    originalMonth!==targetMonth
  ){
    const source=
      await ensureMonth(
        originalMonth
      );

    queueMoveActivity(
      state.user.uid,
      state.config,
      source,
      originalMonth,
      target,
      targetMonth,
      id,
      activity
    );
  }else{
    queueSaveActivity(
      state.user.uid,
      state.config,
      target,
      targetMonth,
      activity,
      id
    );
  }

  renderCore();

  return true;
}

async function trashActivity(
  month,
  id
){
  const m=
    await ensureMonth(month);

  const a=
    findActivity(month,id);

  if(!a)return;

  queueTrashActivity(
    state.user.uid,
    month,
    m,
    id
  );

  renderCore();

  toast(
    'Actividad enviada a la papelera.',
    'success',
    {
      label:'Deshacer',

      onClick:()=>{
        queueRestoreActivity(
          state.user.uid,
          month,
          m,
          id
        );

        renderCore();
      }
    }
  );
}

async function completeActivity(
  month,
  id
){
  const m=
    await ensureMonth(month);

  queueCompleteActivity(
    state.user.uid,
    month,
    m,
    id
  );

  renderCore();

  toast(
    'Actividad marcada como realizada.'
  );
}

function exportFilteredCSV(){
  const rows=[
    [
      'Fecha',
      'Hora',
      'Lugar',
      'Dirección',
      'Actividad',
      'Nota',
      'Etiquetas',
      'Valor',
      'Estado',
      'Prioridad',
      'Pendiente hasta'
    ],
    ...historyActivities().map(a=>[
      a.d,
      a.t,
      placeName(a.p),
      placeAddress(a.p),
      typeName(a.y),
      a.n,
      (a.g||[]).join('|'),
      (a.v/100).toFixed(2),
      STATUSES[a.s],
      PRIORITIES[a.pr],
      a.du
    ])
  ];

  if(rows.length===1){
    return toast(
      'No hay registros para exportar.',
      'error'
    );
  }

  downloadText(
    `worklog-${$('historyMonth').value||currentMonth()}.csv`,
    '\uFEFF'+toCSV(rows),
    'text/csv;charset=utf-8'
  );
}

async function exportAllJSON(){
  const button=
    $('exportAllJsonBtn');

  setButtonBusy(
    button,
    true,
    'Preparando...'
  );

  try{
    const months=
      await loadAllMonths(
        state.user.uid,
        state.config,
        (done,total)=>{
          button.textContent=
            `${done}/${total}`;
        }
      );

    Object.assign(
      state.months,
      months
    );

    const backup=
      makeBackup(
        state.config,
        months
      );

    downloadText(
      `worklog-backup-${today()}.json`,
      JSON.stringify(
        backup,
        null,
        2
      ),
      'application/json;charset=utf-8'
    );

    toast(
      'Copia completa preparada.'
    );

  }catch(error){
    toast(
      error.message||
      'No se pudo crear la copia.',
      'error'
    );
  }finally{
    setButtonBusy(
      button,
      false
    );
  }
}

function parseImportedCsv(rows){
  if(rows.length<2){
    throw new Error(
      'El CSV no contiene registros.'
    );
  }

  const headers=
    rows[0].map(normalizeSearch);

  const idx=
    name=>
      headers.indexOf(
        normalizeSearch(name)
      );

  const fields={
    date:idx('Fecha'),
    time:idx('Hora'),
    place:idx('Lugar'),
    address:idx('Dirección'),
    type:idx('Actividad'),
    note:idx('Nota'),
    tags:idx('Etiquetas'),
    value:idx('Valor'),
    status:idx('Estado'),
    priority:idx('Prioridad'),
    due:idx('Pendiente hasta')
  };

  if(
    fields.date<0||
    fields.place<0||
    fields.type<0
  ){
    throw new Error(
      'El CSV necesita al menos las columnas Fecha, Lugar y Actividad.'
    );
  }

  return rows
    .slice(1)
    .map(r=>({
      date:r[fields.date],

      time:
        fields.time>=0
        ?r[fields.time]
        :localTime(),

      place:
        r[fields.place],

      address:
        fields.address>=0
        ?r[fields.address]
        :'',

      type:
        r[fields.type],

      note:
        fields.note>=0
        ?r[fields.note]
        :'',

      tags:
        fields.tags>=0
        ?r[fields.tags]
        :'',

      value:
        fields.value>=0
        ?r[fields.value]
        :'0',

      status:
        fields.status>=0
        ?r[fields.status]
        :'Realizado',

      priority:
        fields.priority>=0
        ?r[fields.priority]
        :'Media',

      due:
        fields.due>=0
        ?r[fields.due]
        :''
    }))
    .filter(
      r=>
        /^\d{4}-\d{2}-\d{2}$/.test(r.date)&&
        r.place&&
        r.type
    );
}

async function importCsvRows(records){
  const placeMap=
    new Map(
      getActivePlaces(true)
        .map(
          p=>[
            normalizeSearch(p.n),
            p.id
          ]
        )
    );

  const typeMap=
    new Map(
      getTypes(true)
        .map(
          t=>[
            normalizeSearch(t.n),
            t.id
          ]
        )
    );

  for(const row of records){
    let pid=
      placeMap.get(
        normalizeSearch(row.place)
      );

    if(!pid){
      const saved=
        queueSavePlace(
          state.user.uid,
          state.config,
          {
            name:row.place,
            address:row.address,
            categoryId:'OTR'
          }
        );

      pid=saved.id;

      placeMap.set(
        normalizeSearch(row.place),
        pid
      );
    }

    let tid=
      typeMap.get(
        normalizeSearch(row.type)
      );

    if(!tid){
      const saved=
        queueSaveType(
          state.user.uid,
          state.config,
          {
            name:row.type,
            icon:'•'
          }
        );

      tid=saved.id;

      typeMap.set(
        normalizeSearch(row.type),
        tid
      );
    }

    const month=
      monthOf(row.date);

    let m=
      state.months[month];

    if(!m){
      m=
        state.months[month]=
          state.config.m.includes(month)
          ?await ensureMonth(
            month,
            {server:true}
          )
          :emptyMonth();
    }

    const status=
      normalizeSearch(row.status)==='pendiente'
      ?'P'
      :normalizeSearch(row.status)==='cancelado'
        ?'C'
        :'D';

    const priority=
      normalizeSearch(row.priority)==='alta'
      ?'H'
      :normalizeSearch(row.priority)==='baja'
        ?'L'
        :'M';

    queueSaveActivity(
      state.user.uid,
      state.config,
      m,
      month,
      {
        date:row.date,
        time:row.time||'12:00',
        placeId:pid,
        typeId:tid,
        valueCents:parseMoneyToCents(row.value),
        status,
        priority,
        dueDate:row.due||'',
        note:row.note||'',
        tags:String(row.tags||'')
          .split('|')
          .map(v=>v.trim())
          .filter(Boolean),
        deleted:false,
        deletedAt:''
      }
    );
  }

  renderCore();

  toast(
    `${records.length} registros importados y en sincronización.`
  );
}

function applyTheme(
  mode=
    localStorage.getItem('worklog_theme')||
    'auto'
){
  const effective=
    mode==='auto'
    ?(
      matchMedia(
        '(prefers-color-scheme: light)'
      ).matches
      ?'light'
      :'dark'
    )
    :mode;

  document.documentElement.dataset.theme=
    effective;

  localStorage.setItem(
    'worklog_theme',
    mode
  );

  $('themeQuickBtn').textContent=
    effective==='dark'
      ?'☀'
      :'🌙';

  $$('[data-theme-mode]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.themeMode===mode
    );
  });
}

function applyAccent(
  accent=
    localStorage.getItem('worklog_accent')||
    'violet'
){
  document.documentElement.dataset.accent=
    accent;

  localStorage.setItem(
    'worklog_accent',
    accent
  );

  $$('[data-accent]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.accent===accent
    );
  });
}

function applyDensity(
  density=
    localStorage.getItem('worklog_density')||
    'comfortable'
){
  document.body.classList.toggle(
    'compact',
    density==='compact'
  );

  localStorage.setItem(
    'worklog_density',
    density
  );

  $$('[data-density]').forEach(b=>{
    b.classList.toggle(
      'active',
      b.dataset.density===density
    );
  });
}

async function setLocalPin(pin){
  localStorage.setItem(
    'worklog_pin_hash',
    await hashText(pin)
  );

  sessionStorage.setItem(
    'worklog_pin_unlocked',
    '1'
  );

  $('pinStatusText').textContent=
    'Configurado en este dispositivo.';
}

async function verifyPin(pin){
  const hash=
    localStorage.getItem(
      'worklog_pin_hash'
    );

  return !hash||
    await hashText(pin)===hash;
}

function lockIfNeeded(force=false){
  const hash=
    localStorage.getItem(
      'worklog_pin_hash'
    );

  if(!hash)return;

  if(
    force||
    sessionStorage.getItem(
      'worklog_pin_unlocked'
    )!=='1'
  ){
    $('pinLock').classList.remove(
      'hidden'
    );

    $('unlockPin').value='';

    setTimeout(
      ()=>$('unlockPin').focus(),
      20
    );
  }
}

function removePin(){
  localStorage.removeItem(
    'worklog_pin_hash'
  );

  sessionStorage.removeItem(
    'worklog_pin_unlocked'
  );

  $('pinStatusText').textContent=
    'No configurado.';

  $('pinManageBtn').textContent=
    'Configurar';

  $('removePinBtn').classList.add(
    'hidden'
  );

  $('pinLock').classList.add(
    'hidden'
  );
}

function showFatal(message){
  $('fatalErrorText').textContent=
    message||
    'Ocurrió un problema inesperado.';

  $('fatalError').classList.remove(
    'hidden'
  );

  $('bootScreen').classList.add(
    'hidden'
  );
}

function hideFatal(){
  $('fatalError').classList.add(
    'hidden'
  );
}

async function finishDay(){
  const date=
    $('agendaDate').value||
    today();

  const list=
    agendaActivities();

  const pending=
    list.filter(a=>a.s==='P');

  const done=
    list.filter(a=>a.s==='D');

  $('daySummaryContent').innerHTML=`
    <div class="summary-stack">

      <div>
        <span>Realizadas</span>
        <strong>${done.length}</strong>
      </div>

      <div>
        <span>Pendientes</span>
        <strong>${pending.length}</strong>
      </div>

      <div>
        <span>Lugares</span>
        <strong>
          ${new Set(list.map(a=>a.p)).size}
        </strong>
      </div>

      <div>
        <span>Valor</span>
        <strong>
          ${
            moneyFromCents(
              list.reduce(
                (s,a)=>s+a.v,
                0
              )
            )
          }
        </strong>
      </div>

    </div>

    <p class="confirm-text">
      Resumen del
      ${
        formatDate(
          date,
          {
            weekday:'long',
            day:'numeric',
            month:'long'
          }
        )
      }.
      Puedes pasar los pendientes al día siguiente con un toque.
    </p>
  `;

  $('movePendingTomorrowBtn').disabled=
    !pending.length;

  openModal(
    'daySummaryModal'
  );
}

async function movePendingTomorrow(){
  const date=
    $('agendaDate').value||
    today();

  const tomorrow=
    nextDate(date,1);

  const pending=
    agendaActivities()
      .filter(a=>a.s==='P');

  for(const a of pending){
    const source=
      await ensureMonth(
        a.month
      );

    let target=
      state.months[
        monthOf(tomorrow)
      ];

    if(!target){
      target=
        state.months[
          monthOf(tomorrow)
        ]=
          state.config.m.includes(
            monthOf(tomorrow)
          )
          ?await ensureMonth(
            monthOf(tomorrow),
            {server:true}
          )
          :emptyMonth();
    }

    const activity={
      date:tomorrow,
      time:a.t,
      placeId:a.p,
      typeId:a.y,
      valueCents:a.v,
      status:'P',
      priority:a.pr,
      dueDate:a.du,
      note:a.n,
      tags:a.g||[],
      deleted:false,
      deletedAt:''
    };

    queueMoveActivity(
      state.user.uid,
      state.config,
      source,
      a.month,
      target,
      monthOf(tomorrow),
      a.id,
      activity
    );
  }

  closeModal(
    'daySummaryModal'
  );

  renderCore();

  toast(
    `${pending.length} pendiente${pending.length===1?'':'s'} pasado${pending.length===1?'':'s'} a mañana.`
  );
}

function setupSyncUI(){
  subscribeSync(info=>{
    const dot=
      $('syncDot');

    const text=
      $('syncText');

    dot.className=
      'sync-dot';

    if(!info.online){
      dot.classList.add(
        'error'
      );

      text.textContent=
        info.pending
        ?`Sin conexión · ${info.pending} pendiente${info.pending===1?'':'s'}`
        :'Sin conexión';

    }else if(info.error){
      dot.classList.add(
        'error'
      );

      text.textContent=
        'Error al sincronizar';

      toast(
        'Firebase rechazó un cambio. Sincroniza para reconciliar los datos.',
        'error'
      );

    }else if(info.pending){
      dot.classList.add(
        'pending'
      );

      text.textContent=
        `Sincronizando ${info.pending}`;

    }else{
      text.textContent=
        'Guardado';
    }

    $('offlineBanner').classList.toggle(
      'hidden',
      info.online
    );

    if($('settingsSyncDetail')){
      $('settingsSyncDetail').textContent=
        !info.online
        ?'Trabajando sin conexión.'
        :info.pending
          ?`${info.pending} cambio${info.pending===1?'':'s'} pendiente${info.pending===1?'':'s'}.`
          :info.lastSyncedAt
            ?`Última confirmación: ${info.lastSyncedAt.toLocaleTimeString('es-EC',{hour:'2-digit',minute:'2-digit'})}.`
            :'Sin cambios pendientes.';

      $('settingsSyncBadge').textContent=
        !info.online
        ?'⚠ Offline'
        :info.pending
          ?'☁ Sincronizando'
          :'✓ Guardado';
    }
  });
}

function setupPwa(){
  if('serviceWorker' in navigator){
    window.addEventListener(
      'load',
      ()=>{
        navigator.serviceWorker
          .register(
            '/service-worker.js',
            {scope:'/'}
          )
          .catch(
            error=>
              console.warn(
                'SW:',
                error
              )
          );
      }
    );
  }

  window.addEventListener(
    'beforeinstallprompt',
    event=>{
      event.preventDefault();

      state.pwaPrompt=
        event;

      $('installPwaBtn').disabled=
        false;
    }
  );

  $('installPwaBtn')
    .addEventListener(
      'click',
      async()=>{
        if(!state.pwaPrompt){
          return toast(
            'El navegador todavía no ofrece la instalación.',
            'error'
          );
        }

        state.pwaPrompt.prompt();

        await state.pwaPrompt.userChoice;

        state.pwaPrompt=null;

        $('installPwaBtn').disabled=
          true;
      }
    );
}

function setupStaticEvents(){
  setupConfirmModal();

  applyTheme();
  applyAccent();
  applyDensity();

  setupSyncUI();
  setupPwa();

  updateViewportState();

  const mobileMedia=
    matchMedia(
      `(max-width:${MOBILE_BREAKPOINT}px)`
    );

  mobileMedia.addEventListener?.(
    'change',
    updateViewportState
  );

  window.addEventListener(
    'resize',
    debounce(
      updateViewportState,
      120
    )
  );

  window.visualViewport
    ?.addEventListener(
      'resize',
      debounce(
        updateViewportState,
        80
      )
    );

  window.visualViewport
    ?.addEventListener(
      'scroll',
      debounce(
        updateViewportState,
        80
      )
    );

  document.addEventListener(
    'focusin',
    event=>{
      if(
        event.target.matches?.(
          'input,select,textarea'
        )
      ){
        focusIntoView(
          event.target
        );
      }
    }
  );

  matchMedia(
    '(prefers-color-scheme: light)'
  ).addEventListener?.(
    'change',
    ()=>{
      if(
        (
          localStorage.getItem(
            'worklog_theme'
          )||
          'auto'
        )==='auto'
      ){
        applyTheme('auto');
      }
    }
  );

  $('trustedDeviceLogin').checked=
    isTrustedDevice();

  const savedEmailDraft=
    sessionStorage.getItem(
      'worklog_auth_email_draft'
    );

  if(savedEmailDraft){
    $('authEmail').value=
      savedEmailDraft;

    sessionStorage.removeItem(
      'worklog_auth_email_draft'
    );
  }

  $('trustedDeviceLogin')
    .addEventListener(
      'change',
      ()=>{
        const wanted=
          $('trustedDeviceLogin').checked;

        if(
          wanted===isTrustedDevice()
        ){
          return;
        }

        sessionStorage.setItem(
          'worklog_auth_email_draft',
          $('authEmail').value.trim()
        );

        localStorage.setItem(
          'worklog_trusted_device',
          wanted
            ?'true'
            :'false'
        );

        location.reload();
      }
    );

  $$('.auth-tab')
    .forEach(tab=>
      tab.addEventListener(
        'click',
        ()=>{
          state.authMode=
            tab.dataset.authMode;

          $$('.auth-tab')
            .forEach(t=>{
              t.classList.toggle(
                'active',
                t===tab
              );
            });

          const reg=
            state.authMode==='register';

          $('confirmPasswordField')
            .classList.toggle(
              'hidden',
              !reg
            );

          $('forgotPasswordBtn')
            .classList.toggle(
              'hidden',
              reg
            );

          $('authSubmit').textContent=
            reg
            ?'Crear mi cuenta'
            :'Entrar';

          $('authTitle').textContent=
            reg
            ?'Crea tu cuenta'
            :'Bienvenido';

          $('authSubtitle').textContent=
            reg
            ?'Tus datos quedarán separados por usuario.'
            :'Ingresa a tu cuenta para continuar.';

          clearAuthMessage();
        }
      )
    );

  state.authMode='login';

  $('authForm')
    .addEventListener(
      'submit',
      async event=>{
        event.preventDefault();

        clearAuthMessage();

        const email=
          $('authEmail').value.trim();

        const password=
          $('authPassword').value;

        try{
          setButtonBusy(
            $('authSubmit'),
            true,
            state.authMode==='register'
              ?'Creando...'
              :'Entrando...'
          );

          if(
            state.authMode==='register'
          ){
            if(
              password!==
              $('authConfirm').value
            ){
              throw new Error(
                'Las contraseñas no coinciden.'
              );
            }

            await registerUser(
              email,
              password
            );

          }else{
            await loginUser(
              email,
              password
            );
          }

        }catch(error){
          showAuthMessage(
            authErrorMessage(error)
          );

        }finally{
          setButtonBusy(
            $('authSubmit'),
            false
          );
        }
      }
    );

  $('forgotPasswordBtn')
    .addEventListener(
      'click',
      async()=>{
        const email=
          $('authEmail').value.trim();

        if(!email){
          return showAuthMessage(
            'Escribe primero tu correo.'
          );
        }

        try{
          await resetPassword(email);

          showAuthMessage(
            'Te enviamos un correo para restablecer la contraseña.',
            'success'
          );

        }catch(error){
          showAuthMessage(
            authErrorMessage(error)
          );
        }
      }
    );

  $('logoutBtn')
    .addEventListener(
      'click',
      async()=>{
        sessionStorage.removeItem(
          'worklog_pin_unlocked'
        );

        await logoutUser();
      }
    );

  $('unlockLogoutBtn')
    .addEventListener(
      'click',
      async()=>{
        sessionStorage.removeItem(
          'worklog_pin_unlocked'
        );

        await logoutUser();
      }
    );

  $('menuBtn')
    .addEventListener(
      'click',
      openSidebar
    );

  $('sidebarOverlay')
    .addEventListener(
      'click',
      closeSidebar
    );

  $('mobileMoreBtn')
    .addEventListener(
      'click',
      openSidebar
    );

  $$('.nav-button')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>openPage(
          b.dataset.page
        )
      )
    );

  $$('.mobile-nav[data-page]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>openPage(
          b.dataset.page
        )
      )
    );

  $$('[data-go-page]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>{
          openPage(
            b.dataset.goPage
          );

          const anchor=
            b.dataset.settingsAnchor;

          if(anchor){
            setTimeout(
              ()=>
                $(`${anchor}`)
                  ?.scrollIntoView({
                    behavior:'smooth'
                  }),
              60
            );
          }
        }
      )
    );

  $$('[data-open-activity]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>openActivityEditor()
      )
    );

  $$('[data-close-modal]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>{
          closeModal(
            b.dataset.closeModal
          );
        }
      )
    );

  $$('.modal-backdrop')
    .forEach(m=>
      m.addEventListener(
        'click',
        e=>{
          if(
            e.target===m&&
            ![
              'confirmModal'
            ].includes(m.id)
          ){
            closeModal(m.id);
          }
        }
      )
    );

  document.addEventListener(
    'keydown',
    e=>{
      if(e.key==='Escape'){
        $$('.modal-backdrop.show')
          .filter(
            m=>
              m.id!=='confirmModal'
          )
          .forEach(
            m=>closeModal(m.id)
          );
      }
    }
  );

  $('themeQuickBtn')
    .addEventListener(
      'click',
      ()=>{
        applyTheme(
          document
            .documentElement
            .dataset
            .theme==='dark'
            ?'light'
            :'dark'
        );
      }
    );

  $$('[data-theme-mode]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>applyTheme(
          b.dataset.themeMode
        )
      )
    );

  $$('[data-accent]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>applyAccent(
          b.dataset.accent
        )
      )
    );

  $$('[data-density]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>applyDensity(
          b.dataset.density
        )
      )
    );

  $('globalSearchBtn')
    .addEventListener(
      'click',
      ()=>{
        openPage('history');

        setTimeout(
          ()=>
            $('historySearch')
              .focus(),
          50
        );
      }
    );

  $('syncButton')
    .addEventListener(
      'click',
      ()=>{
        syncConfigAndMonth()
          .then(ok=>{
            if(ok){
              toast(
                'Sincronización actualizada.'
              );
            }
          })
          .catch(
            e=>toast(
              e.message,
              'error'
            )
          );
      }
    );

  $('settingsSyncBtn')
    .addEventListener(
      'click',
      ()=>{
        syncConfigAndMonth()
          .then(ok=>{
            if(ok){
              toast(
                'Sincronización actualizada.'
              );
            }
          })
          .catch(
            e=>toast(
              e.message,
              'error'
            )
          );
      }
    );

  $('repeatLastBtn')
    .addEventListener(
      'click',
      ()=>{
        const a=
          lastActivity();

        if(!a){
          return toast(
            'Todavía no hay una actividad para repetir.',
            'error'
          );
        }

        openActivityEditor({
          month:a.month,
          id:a.id,
          repeat:true
        });
      }
    );

  $('quickPlace')
    .addEventListener(
      'change',
      ()=>{
        setSuggestedTypeForPlace(
          $('quickPlace').value,
          'quickType',
          true
        );
      }
    );

  $('activityPlace')
    .addEventListener(
      'change',
      ()=>{
        setSuggestedTypeForPlace(
          $('activityPlace').value,
          'activityType',
          false
        );
      }
    );

  document.addEventListener(
    'click',
    event=>{
      const chip=
        event.target.closest(
          '.note-chip'
        );

      if(chip){
        const target=
          chip.closest(
            '#quickNoteChips'
          )
          ?$('quickNote')
          :$('activityNote');

        target.value=
          chip.dataset.note;

        target.focus();
      }
    }
  );

  $('quickForm')
    .addEventListener(
      'submit',
      async event=>{
        event.preventDefault();

        try{
          setButtonBusy(
            $('quickSaveBtn'),
            true,
            'Guardando...'
          );

          const ok=
            await saveActivityOptimistic(
              activityFromForm('quick')
            );

          if(ok){
            $('quickValue').value='';
            $('quickNote').value='';
            $('quickStatus').value='D';

            mobileFeedback(18);

            toast(
              navigator.onLine
              ?'Guardado al instante; sincronizando.'
              :'Guardado localmente; se sincronizará después.'
            );
          }

        }catch(error){
          toast(
            error.message,
            'error'
          );

        }finally{
          setTimeout(
            ()=>{
              setButtonBusy(
                $('quickSaveBtn'),
                false
              );
            },
            180
          );
        }
      }
    );

  $('activityForm')
    .addEventListener(
      'submit',
      async event=>{
        event.preventDefault();

        try{
          setButtonBusy(
            $('activitySaveBtn'),
            true,
            'Guardando...'
          );

          const id=
            $('activityId').value||
            null;

          const original=
            $('activityOriginalMonth').value||
            null;

          const ok=
            await saveActivityOptimistic(
              activityFromForm('activity'),
              {
                id,
                originalMonth:original
              }
            );

          if(ok){
            closeModal(
              'activityModal'
            );

            mobileFeedback(18);

            toast(
              'Actividad añadida a la interfaz.'
            );
          }

        }catch(error){
          toast(
            error.message,
            'error'
          );

        }finally{
          setTimeout(
            ()=>{
              setButtonBusy(
                $('activitySaveBtn'),
                false
              );
            },
            180
          );
        }
      }
    );

  $('quickTemplates')
    .addEventListener(
      'click',
      e=>{
        const t=
          e.target.closest(
            '[data-template]'
          );

        const p=
          e.target.closest(
            '[data-fast-place]'
          );

        if(t){
          const q=
            state.config.q[
              t.dataset.template
            ];

          $('quickPlace').value=
            q.p;

          $('quickType').value=
            q.y;

          $('quickNote').value=
            q.note||'';

          mobileFeedback();
        }

        if(p){
          $('quickPlace').value=
            p.dataset.fastPlace;

          setSuggestedTypeForPlace(
            p.dataset.fastPlace,
            'quickType',
            true
          );

          mobileFeedback();
        }
      }
    );

  let draggedTemplate=null;

  $('quickTemplates')
    .addEventListener(
      'dragstart',
      e=>{
        if(state.mobile){
          e.preventDefault();
          return;
        }

        const el=
          e.target.closest(
            '[data-template]'
          );

        if(el){
          draggedTemplate=
            el.dataset.template;

          el.classList.add(
            'dragging'
          );
        }
      }
    );

  $('quickTemplates')
    .addEventListener(
      'dragend',
      e=>{
        e.target
          .closest('[data-template]')
          ?.classList
          .remove('dragging');

        draggedTemplate=null;
      }
    );

  $('quickTemplates')
    .addEventListener(
      'dragover',
      e=>{
        if(!state.mobile){
          e.preventDefault();
        }
      }
    );

  $('quickTemplates')
    .addEventListener(
      'drop',
      e=>{
        if(state.mobile)return;

        e.preventDefault();

        const target=
          e.target.closest(
            '[data-template]'
          );

        if(
          !draggedTemplate||
          !target||
          draggedTemplate===
            target.dataset.template
        ){
          return;
        }

        const ids=
          getTemplates()
            .map(q=>q.id);

        const from=
          ids.indexOf(
            draggedTemplate
          );

        const to=
          ids.indexOf(
            target.dataset.template
          );

        ids.splice(
          to,
          0,
          ids.splice(from,1)[0]
        );

        queueReorderTemplates(
          state.user.uid,
          state.config,
          ids
        );

        renderTemplates();
        renderManagers();
      }
    );

  $('pendingList')
    .addEventListener(
      'click',
      e=>{
        const b=
          e.target.closest(
            '[data-complete]'
          );

        if(b){
          const [m,id]=
            b.dataset.complete
              .split('|');

          completeActivity(
            m,
            id
          );
        }
      }
    );

  $('newPlaceBtn')
    .addEventListener(
      'click',
      ()=>openPlaceEditor()
    );

  $$('[data-place-tab]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>{
          state.placeTab=
            b.dataset.placeTab;

          $$('[data-place-tab]')
            .forEach(x=>{
              x.classList.toggle(
                'active',
                x===b
              );
            });

          renderPlaces();
        }
      )
    );

  $('placeSearch')
    .addEventListener(
      'input',
      debounce(renderPlaces)
    );

  $('placeCategoryFilter')
    .addEventListener(
      'change',
      renderPlaces
    );

  $('placesGrid')
    .addEventListener(
      'click',
      async e=>{
        const fav=
          e.target.closest(
            '[data-place-favorite]'
          );

        const use=
          e.target.closest(
            '[data-place-use]'
          );

        const edit=
          e.target.closest(
            '[data-place-edit]'
          );

        const arch=
          e.target.closest(
            '[data-place-archive]'
          );

        const restore=
          e.target.closest(
            '[data-place-restore]'
          );

        if(fav){
          const id=
            fav.dataset.placeFavorite;

          queueFavoritePlace(
            state.user.uid,
            state.config,
            id,
            !state.config.p[id].f
          );

          renderPlaces();
          renderTemplates();
        }

        if(use){
          openPage(
            'dashboard'
          );

          $('quickPlace').value=
            use.dataset.placeUse;

          setSuggestedTypeForPlace(
            use.dataset.placeUse,
            'quickType',
            true
          );

          mobileFeedback();

          if(state.mobile){
            setTimeout(
              ()=>{
                $('quickForm')
                  .scrollIntoView({
                    behavior:'smooth',
                    block:'start'
                  });
              },
              80
            );
          }
        }

        if(edit){
          openPlaceEditor(
            edit.dataset.placeEdit
          );
        }

        if(arch){
          const id=
            arch.dataset.placeArchive;

          if(
            await confirmAction(
              'Archivar lugar',
              `¿Archivar “${placeName(id)}”? El historial antiguo conservará el nombre.`,
              {
                okLabel:'Archivar'
              }
            )
          ){
            queueArchivePlace(
              state.user.uid,
              state.config,
              id,
              true
            );

            renderCore();
          }
        }

        if(restore){
          queueArchivePlace(
            state.user.uid,
            state.config,
            restore.dataset.placeRestore,
            false
          );

          renderCore();
        }
      }
    );

  $('placeForm')
    .addEventListener(
      'submit',
      e=>{
        e.preventDefault();

        const id=
          $('placeId').value||
          null;

        queueSavePlace(
          state.user.uid,
          state.config,
          {
            name:$('placeName').value,
            address:$('placeAddress').value,
            categoryId:$('placeCategory').value,
            reference:$('placeReference').value
          },
          id
        );

        closeModal(
          'placeModal'
        );

        renderCore();

        toast(
          id
            ?'Lugar actualizado.'
            :'Lugar creado.'
        );
      }
    );

  $('agendaDate')
    .addEventListener(
      'change',
      prepareAgenda
    );

  $('addStopBtn')
    .addEventListener(
      'click',
      ()=>{
        openActivityEditor({
          date:
            $('agendaDate').value||
            today(),
          status:'P'
        });
      }
    );

  $('agendaList')
    .addEventListener(
      'click',
      e=>{
        const complete=
          e.target.closest(
            '[data-agenda-complete]'
          );

        const edit=
          e.target.closest(
            '[data-agenda-edit]'
          );

        if(complete){
          const [m,id]=
            complete
              .dataset
              .agendaComplete
              .split('|');

          completeActivity(
            m,
            id
          );
        }

        if(edit){
          const [m,id]=
            edit
              .dataset
              .agendaEdit
              .split('|');

          openActivityEditor({
            month:m,
            id
          });
        }
      }
    );

  $('finishDayBtn')
    .addEventListener(
      'click',
      finishDay
    );

  $('movePendingTomorrowBtn')
    .addEventListener(
      'click',
      movePendingTomorrow
    );

  $('historySearch')
    .addEventListener(
      'input',
      debounce(renderHistory)
    );

  [
    'historyDay',
    'historyFrom',
    'historyTo',
    'historyPlace',
    'historyType',
    'historyStatus',
    'historyPriority',
    'historyMoney'
  ].forEach(id=>{
    $(id).addEventListener(
      'change',
      ()=>{
        state.historyRange=null;
        renderHistory();
      }
    );
  });

  $('historyMonth')
    .addEventListener(
      'change',
      async()=>{
        state.historyRange=null;

        await ensureMonth(
          $('historyMonth').value,
          {server:true}
        );

        renderHistory();
      }
    );

  $$('[data-history-preset]')
    .forEach(b=>
      b.addEventListener(
        'click',
        async()=>{
          const preset=
            b.dataset.historyPreset;

          $$('[data-history-preset]')
            .forEach(x=>{
              x.classList.toggle(
                'active',
                x===b
              );
            });

          $('historyDay').value='';
          $('historyFrom').value='';
          $('historyTo').value='';
          $('historyStatus').value='';

          if(preset==='today'){
            $('historyDay').value=
              today();

            state.historyRange=null;

            $('historyMonth').value=
              currentMonth();

            await ensureMonth(
              currentMonth(),
              {server:true}
            );

          }else if(
            preset==='week'
          ){
            const start=
              startOfWeek();

            const end=
              endOfWeek();

            $('historyFrom').value=
              start;

            $('historyTo').value=
              end;

            state.historyRange={
              start,
              end
            };

            let m=
              monthOf(start);

            while(
              m<=monthOf(end)
            ){
              await ensureMonth(
                m,
                {server:true}
              );

              m=
                shiftMonth(m,1);
            }

          }else if(
            preset==='pending'
          ){
            $('historyStatus').value=
              'P';

            state.historyRange=null;

          }else if(
            preset==='clear'
          ){
            state.historyRange=null;

            $('historySearch').value='';
            $('historyFrom').value='';
            $('historyTo').value='';
            $('historyPlace').value='';
            $('historyType').value='';
            $('historyStatus').value='';
            $('historyPriority').value='';
            $('historyMoney').value='';

          }else{
            state.historyRange=null;

            $('historyMonth').value=
              currentMonth();

            await ensureMonth(
              currentMonth(),
              {server:true}
            );
          }

          renderHistory();
        }
      )
    );

  $('historyBody')
    .addEventListener(
      'click',
      async e=>{
        const rep=
          e.target.closest(
            '[data-history-repeat]'
          );

        const edit=
          e.target.closest(
            '[data-history-edit]'
          );

        const del=
          e.target.closest(
            '[data-history-trash]'
          );

        if(rep){
          const [m,id]=
            rep.dataset
              .historyRepeat
              .split('|');

          openActivityEditor({
            month:m,
            id,
            repeat:true
          });
        }

        if(edit){
          const [m,id]=
            edit.dataset
              .historyEdit
              .split('|');

          openActivityEditor({
            month:m,
            id
          });
        }

        if(del){
          const [m,id]=
            del.dataset
              .historyTrash
              .split('|');

          await trashActivity(
            m,
            id
          );
        }
      }
    );

  $('exportCsvBtn')
    .addEventListener(
      'click',
      exportFilteredCSV
    );

  $('settingsExportMonthBtn')
    .addEventListener(
      'click',
      exportFilteredCSV
    );

  $('calendarMonth')
    .addEventListener(
      'change',
      async()=>{
        state.calendarDay=null;

        await ensureMonth(
          $('calendarMonth').value,
          {server:true}
        );

        renderCalendar();
      }
    );

  $('calendarPrev')
    .addEventListener(
      'click',
      ()=>{
        $('calendarMonth').value=
          shiftMonth(
            $('calendarMonth').value,
            -1
          );

        $('calendarMonth')
          .dispatchEvent(
            new Event('change')
          );
      }
    );

  $('calendarNext')
    .addEventListener(
      'click',
      ()=>{
        $('calendarMonth').value=
          shiftMonth(
            $('calendarMonth').value,
            1
          );

        $('calendarMonth')
          .dispatchEvent(
            new Event('change')
          );
      }
    );

  $('calendarGrid')
    .addEventListener(
      'click',
      async e=>{
        const day=
          e.target.closest(
            '[data-calendar-day]'
          );

        if(!day)return;

        const date=
          day.dataset.calendarDay;

        if(
          monthOf(date)!==
          $('calendarMonth').value
        ){
          $('calendarMonth').value=
            monthOf(date);

          await ensureMonth(
            monthOf(date),
            {server:true}
          );
        }

        state.calendarDay=
          date;

        renderCalendar();
      }
    );

  $('reportMonth')
    .addEventListener(
      'change',
      ()=>{
        state.reportYear=null;
        prepareReports();
      }
    );

  $('loadYearBtn')
    .addEventListener(
      'click',
      async()=>{
        const year=
          (
            $('reportMonth').value||
            currentMonth()
          ).slice(0,4);

        const months=
          state.config.m.filter(
            m=>m.startsWith(year+'-')
          );

        const button=
          $('loadYearBtn');

        setButtonBusy(
          button,
          true,
          'Cargando...'
        );

        try{
          for(
            let i=0;
            i<months.length;
            i++
          ){
            button.textContent=
              `${i+1}/${months.length}`;

            await ensureMonth(
              months[i],
              {server:true}
            );
          }

          state.reportYear=
            year;

          renderReports();

          toast(
            `Año ${year} cargado para análisis.`
          );

        }catch(error){
          toast(
            error.message,
            'error'
          );

        }finally{
          setButtonBusy(
            button,
            false
          );
        }
      }
    );

  $('printReportBtn')
    .addEventListener(
      'click',
      ()=>window.print()
    );

  $('newTypeBtn')
    .addEventListener(
      'click',
      ()=>openTypeEditor()
    );

  $$('[data-type-tab]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>{
          state.typeTab=
            b.dataset.typeTab;

          $$('[data-type-tab]')
            .forEach(x=>{
              x.classList.toggle(
                'active',
                x===b
              );
            });

          renderManagers();
        }
      )
    );

  $('typesManager')
    .addEventListener(
      'click',
      async e=>{
        const edit=
          e.target.closest(
            '[data-type-edit]'
          );

        const fav=
          e.target.closest(
            '[data-type-favorite]'
          );

        const arch=
          e.target.closest(
            '[data-type-archive]'
          );

        const restore=
          e.target.closest(
            '[data-type-restore]'
          );

        if(edit){
          openTypeEditor(
            edit.dataset.typeEdit
          );
        }

        if(fav){
          const id=
            fav.dataset.typeFavorite;

          queueFavoriteType(
            state.user.uid,
            state.config,
            id,
            !state.config.t[id].f
          );

          renderCore();
        }

        if(
          arch&&
          await confirmAction(
            'Archivar actividad',
            `¿Archivar “${typeName(arch.dataset.typeArchive)}”? Los registros antiguos conservarán el nombre.`,
            {
              okLabel:'Archivar'
            }
          )
        ){
          queueArchiveType(
            state.user.uid,
            state.config,
            arch.dataset.typeArchive,
            true
          );

          renderCore();
        }

        if(restore){
          queueArchiveType(
            state.user.uid,
            state.config,
            restore.dataset.typeRestore,
            false
          );

          renderCore();
        }
      }
    );

  $('typeForm')
    .addEventListener(
      'submit',
      e=>{
        e.preventDefault();

        const id=
          $('typeId').value||
          null;

        queueSaveType(
          state.user.uid,
          state.config,
          {
            name:$('typeName').value,
            icon:$('typeIcon').value,
            favorite:$('typeFavorite').checked
          },
          id
        );

        closeModal(
          'typeModal'
        );

        renderCore();

        toast(
          id
            ?'Actividad actualizada.'
            :'Actividad creada.'
        );
      }
    );

  $('newCategoryBtn')
    .addEventListener(
      'click',
      ()=>openCategoryEditor()
    );

  $$('[data-category-tab]')
    .forEach(b=>
      b.addEventListener(
        'click',
        ()=>{
          state.categoryTab=
            b.dataset.categoryTab;

          $$('[data-category-tab]')
            .forEach(x=>{
              x.classList.toggle(
                'active',
                x===b
              );
            });

          renderManagers();
        }
      )
    );

  $('categoriesManager')
    .addEventListener(
      'click',
      async e=>{
        const edit=
          e.target.closest(
            '[data-category-edit]'
          );

        const arch=
          e.target.closest(
            '[data-category-archive]'
          );

        const restore=
          e.target.closest(
            '[data-category-restore]'
          );

        if(edit){
          openCategoryEditor(
            edit.dataset.categoryEdit
          );
        }

        if(
          arch&&
          await confirmAction(
            'Archivar categoría',
            `¿Archivar “${categoryName(arch.dataset.categoryArchive)}”?`,
            {
              okLabel:'Archivar'
            }
          )
        ){
          queueArchiveCategory(
            state.user.uid,
            state.config,
            arch.dataset.categoryArchive,
            true
          );

          renderCore();
        }

        if(restore){
          queueArchiveCategory(
            state.user.uid,
            state.config,
            restore.dataset.categoryRestore,
            false
          );

          renderCore();
        }
      }
    );

  $('categoryForm')
    .addEventListener(
      'submit',
      e=>{
        e.preventDefault();

        const id=
          $('categoryId').value||
          null;

        queueSaveCategory(
          state.user.uid,
          state.config,
          {
            name:$('categoryName').value,
            icon:$('categoryIcon').value
          },
          id
        );

        closeModal(
          'categoryModal'
        );

        renderCore();

        toast(
          id
            ?'Categoría actualizada.'
            :'Categoría creada.'
        );
      }
    );

  $('newTemplateBtn')
    .addEventListener(
      'click',
      ()=>openTemplateEditor()
    );

  $('templatesManager')
    .addEventListener(
      'click',
      async e=>{
        const edit=
          e.target.closest(
            '[data-template-edit]'
          );

        const arch=
          e.target.closest(
            '[data-template-archive]'
          );

        const up=
          e.target.closest(
            '[data-template-up]'
          );

        const down=
          e.target.closest(
            '[data-template-down]'
          );

        if(edit){
          openTemplateEditor(
            edit.dataset.templateEdit
          );
        }

        if(arch){
          queueArchiveTemplate(
            state.user.uid,
            state.config,
            arch.dataset.templateArchive,
            true
          );

          renderCore();
        }

        if(up||down){
          const id=
            (up||down).dataset[
              up
                ?'templateUp'
                :'templateDown'
            ];

          const ids=
            getTemplates()
              .map(q=>q.id);

          const i=
            ids.indexOf(id);

          const j=
            i+(up?-1:1);

          if(
            j>=0&&
            j<ids.length
          ){
            [
              ids[i],
              ids[j]
            ]=[
              ids[j],
              ids[i]
            ];

            queueReorderTemplates(
              state.user.uid,
              state.config,
              ids
            );

            renderCore();
          }
        }
      }
    );

  $('templateForm')
    .addEventListener(
      'submit',
      e=>{
        e.preventDefault();

        const id=
          $('templateId').value||
          null;

        queueSaveTemplate(
          state.user.uid,
          state.config,
          {
            name:$('templateName').value,
            placeId:$('templatePlace').value,
            typeId:$('templateType').value,
            note:$('templateNote').value
          },
          id
        );

        closeModal(
          'templateModal'
        );

        renderCore();

        toast(
          id
            ?'Plantilla actualizada.'
            :'Plantilla creada.'
        );
      }
    );

  $('newNoteBtn')
    .addEventListener(
      'click',
      ()=>{
        $('noteForm').reset();
        openModal('noteModal');
      }
    );

  $('noteForm')
    .addEventListener(
      'submit',
      e=>{
        e.preventDefault();

        const text=
          $('noteText').value.trim();

        queueSaveNotes(
          state.user.uid,
          state.config,
          [
            ...(state.config.n||[]),
            text
          ]
        );

        closeModal(
          'noteModal'
        );

        renderCore();

        toast(
          'Nota rápida añadida.'
        );
      }
    );

  $('notesManager')
    .addEventListener(
      'click',
      e=>{
        const b=
          e.target.closest(
            '[data-note-remove]'
          );

        if(b){
          const notes=[
            ...state.config.n
          ];

          notes.splice(
            Number(
              b.dataset.noteRemove
            ),
            1
          );

          queueSaveNotes(
            state.user.uid,
            state.config,
            notes
          );

          renderCore();
        }
      }
    );

  $('trashManager')
    .addEventListener(
      'click',
      async e=>{
        const restore=
          e.target.closest(
            '[data-trash-restore]'
          );

        const purge=
          e.target.closest(
            '[data-trash-purge]'
          );

        if(restore){
          const [m,id]=
            restore
              .dataset
              .trashRestore
              .split('|');

          const ms=
            await ensureMonth(m);

          queueRestoreActivity(
            state.user.uid,
            m,
            ms,
            id
          );

          renderCore();

          toast(
            'Actividad restaurada.'
          );
        }

        if(purge){
          const [m,id]=
            purge
              .dataset
              .trashPurge
              .split('|');

          if(
            await confirmAction(
              'Eliminar definitivamente',
              'Esta acción no se puede deshacer.',
              {
                okLabel:'Eliminar'
              }
            )
          ){
            const ms=
              await ensureMonth(m);

            queuePurgeActivity(
              state.user.uid,
              m,
              ms,
              id
            );

            renderCore();
          }
        }
      }
    );

  $('exportAllJsonBtn')
    .addEventListener(
      'click',
      exportAllJSON
    );

  $('importJsonBtn')
    .addEventListener(
      'click',
      ()=>{
        $('jsonFileInput').click();
      }
    );

  $('jsonFileInput')
    .addEventListener(
      'change',
      async()=>{
        const file=
          $('jsonFileInput').files[0];

        if(!file)return;

        try{
          const data=
            JSON.parse(
              await file.text()
            );

          validateBackup(data);

          if(
            !await confirmAction(
              'Importar copia',
              'La copia se combinará con la estructura actual. Se recomienda exportar una copia antes.',
              {
                danger:false,
                okLabel:'Importar'
              }
            )
          ){
            return;
          }

          const result=
            await importBackup(
              state.user.uid,
              data
            );

          state.config=
            result.config;

          Object.assign(
            state.months,
            result.months
          );

          renderCore();

          toast(
            'Copia importada.'
          );

        }catch(error){
          toast(
            error.message,
            'error'
          );

        }finally{
          $('jsonFileInput').value='';
        }
      }
    );

  $('importCsvBtn')
    .addEventListener(
      'click',
      ()=>{
        $('csvFileInput').click();
      }
    );

  $('csvFileInput')
    .addEventListener(
      'change',
      async()=>{
        const file=
          $('csvFileInput').files[0];

        if(!file)return;

        try{
          const records=
            parseImportedCsv(
              parseCSV(
                await file.text()
              )
            );

          if(!records.length){
            throw new Error(
              'No se encontraron filas válidas.'
            );
          }

          if(
            !await confirmAction(
              'Importar CSV',
              `Se importarán ${records.length} registros.`,
              {
                danger:false,
                okLabel:'Importar'
              }
            )
          ){
            return;
          }

          await importCsvRows(
            records
          );

        }catch(error){
          toast(
            error.message,
            'error'
          );

        }finally{
          $('csvFileInput').value='';
        }
      }
    );

  $('trustedDeviceToggle')
    .addEventListener(
      'change',
      async()=>{
        const value=
          $('trustedDeviceToggle').checked;

        if(
          !await confirmAction(
            'Cambiar persistencia',
            value
              ?'Al recargar, WorkLog conservará caché persistente en este dispositivo.'
              :'Se cerrará la sesión, se limpiará la caché de Firestore y se recargará la página.',
            {
              danger:!value,
              okLabel:'Aplicar y recargar'
            }
          )
        ){
          $('trustedDeviceToggle').checked=
            !value;

          return;
        }

        if(!value){
          await logoutUser();
        }

        await applyTrustedDevicePreference(
          value
        );

        location.reload();
      }
    );

  $('pinManageBtn')
    .addEventListener(
      'click',
      ()=>{
        $('pinForm').reset();

        $('removePinBtn')
          .classList.toggle(
            'hidden',
            !localStorage.getItem(
              'worklog_pin_hash'
            )
          );

        openModal(
          'pinModal'
        );
      }
    );

  $('pinForm')
    .addEventListener(
      'submit',
      async e=>{
        e.preventDefault();

        const pin=
          $('pinInput').value;

        const confirm=
          $('pinConfirmInput').value;

        if(
          !/^\d{4,8}$/.test(pin)
        ){
          return toast(
            'El PIN debe tener de 4 a 8 dígitos.',
            'error'
          );
        }

        if(pin!==confirm){
          return toast(
            'Los PIN no coinciden.',
            'error'
          );
        }

        await setLocalPin(pin);

        closeModal(
          'pinModal'
        );

        renderSettings();

        toast(
          'PIN local configurado.'
        );
      }
    );

  $('removePinBtn')
    .addEventListener(
      'click',
      ()=>{
        removePin();

        closeModal(
          'pinModal'
        );

        renderSettings();

        toast(
          'PIN eliminado.'
        );
      }
    );

  $('pinTimeoutSelect')
    .addEventListener(
      'change',
      ()=>{
        localStorage.setItem(
          'worklog_pin_timeout',
          $('pinTimeoutSelect').value
        );
      }
    );

  $('unlockForm')
    .addEventListener(
      'submit',
      async e=>{
        e.preventDefault();

        if(
          await verifyPin(
            $('unlockPin').value
          )
        ){
          sessionStorage.setItem(
            'worklog_pin_unlocked',
            '1'
          );

          $('pinLock')
            .classList.add(
              'hidden'
            );

        }else{
          toast(
            'PIN incorrecto.',
            'error'
          );
        }
      }
    );

  $('verifyEmailBtn')
    .addEventListener(
      'click',
      async()=>{
        try{
          await sendVerification();

          toast(
            'Correo de verificación enviado.'
          );

        }catch(error){
          toast(
            authErrorMessage(error),
            'error'
          );
        }
      }
    );

  $('changePasswordBtn')
    .addEventListener(
      'click',
      ()=>{
        $('accountForm').reset();

        $('accountAction').value=
          'password';

        $('accountModalTitle').textContent=
          'Cambiar contraseña';

        $('newPasswordField')
          .classList.remove(
            'hidden'
          );

        $('accountSubmitBtn').textContent=
          'Cambiar contraseña';

        openModal(
          'accountModal'
        );
      }
    );

  $('deleteAccountBtn')
    .addEventListener(
      'click',
      async()=>{
        if(
          !await confirmAction(
            'Eliminar cuenta',
            'Se intentarán eliminar los datos conocidos de WorkLog y luego la cuenta. Esta acción es irreversible.',
            {
              okLabel:'Continuar'
            }
          )
        ){
          return;
        }

        $('accountForm').reset();

        $('accountAction').value=
          'delete';

        $('accountModalTitle').textContent=
          'Eliminar cuenta';

        $('newPasswordField')
          .classList.add(
            'hidden'
          );

        $('accountSubmitBtn').textContent=
          'Eliminar definitivamente';

        openModal(
          'accountModal'
        );
      }
    );

  $('accountForm')
    .addEventListener(
      'submit',
      async e=>{
        e.preventDefault();

        const action=
          $('accountAction').value;

        const current=
          $('accountCurrentPassword').value;

        try{
          setButtonBusy(
            $('accountSubmitBtn'),
            true,
            'Procesando...'
          );

          if(action==='password'){
            const next=
              $('accountNewPassword').value;

            if(next.length<6){
              throw new Error(
                'La nueva contraseña debe tener al menos 6 caracteres.'
              );
            }

            await changePassword(
              current,
              next
            );

            toast(
              'Contraseña actualizada.'
            );

          }else{
            await reauthenticate(
              current
            );

            const uid=
              state.user.uid;

            await deleteAllUserData(
              uid,
              state.config
            );

            await deleteOwnUserAccess(
              uid
            );

            await deleteCurrentUserNow();

            sessionStorage.removeItem(
              'worklog_pin_unlocked'
            );

            toast(
              'Cuenta eliminada.'
            );
          }

          closeModal(
            'accountModal'
          );

        }catch(error){
          toast(
            authErrorMessage(error),
            'error'
          );

        }finally{
          setButtonBusy(
            $('accountSubmitBtn'),
            false
          );
        }
      }
    );

  $('fatalRetryBtn')
    .addEventListener(
      'click',
      ()=>{
        hideFatal();

        syncConfigAndMonth()
          .catch(
            e=>showFatal(
              e.message
            )
          );
      }
    );

  $('fatalReloadBtn')
    .addEventListener(
      'click',
      ()=>location.reload()
    );

  window.addEventListener(
    'online',
    ()=>{
      $('offlineBanner')
        .classList.add(
          'hidden'
        );

      setTimeout(
        ()=>{
          if(state.user){
            waitForSync()
              .catch(()=>false);
          }
        },
        250
      );
    }
  );

  window.addEventListener(
    'offline',
    ()=>{
      $('offlineBanner')
        .classList.remove(
          'hidden'
        );
    }
  );

  document.addEventListener(
    'visibilitychange',
    ()=>{
      if(document.hidden){
        state.lastHiddenAt=
          Date.now();

        return;
      }

      const timeout=
        Number(
          localStorage.getItem(
            'worklog_pin_timeout'
          )||
          5
        );

      if(
        timeout>0&&
        state.lastHiddenAt&&
        Date.now()-
          state.lastHiddenAt>
          timeout*60000
      ){
        sessionStorage.removeItem(
          'worklog_pin_unlocked'
        );

        lockIfNeeded(true);
      }

      if(
        navigator.onLine&&
        state.user&&
        state.lastHiddenAt&&
        Date.now()-
          state.lastHiddenAt>
          120000
      ){
        syncConfigAndMonth()
          .catch(()=>{});
      }
    }
  );
}

async function verifyUserAccess(user){
  const access=
    await ensureUserAccess(
      user
    );

  state.access=
    access;

  if(
    !access||
    access.allowed!==false
  ){
    return true;
  }

  let message=
    'Tu cuenta no tiene acceso a WorkLog.';

  if(
    access.status==='suspended'
  ){
    message=
      access.blockedUntil
      ?`Tu cuenta está suspendida hasta ${access.blockedUntil.toLocaleString('es-EC')}.`
      :'Tu cuenta está suspendida temporalmente.';
  }

  if(
    access.status==='blocked'
  ){
    message=
      'Tu cuenta está bloqueada. Contacta al administrador de WorkLog.';
  }

  state.pendingAuthMessage=
    message;

  sessionStorage.removeItem(
    'worklog_pin_unlocked'
  );

  await logoutUser();

  return false;
}

async function bootUser(user){
  state.user=user;

  $('authScreen')
    .classList.add(
      'hidden'
    );

  $('appScreen')
    .classList.remove(
      'hidden'
    );

  $('userEmail').textContent=
    user.email||
    'Usuario';

  $('userName').textContent=
    (
      user.email||
      'Usuario'
    ).split('@')[0];

  $('userAvatar').textContent=
    (
      user.email||
      'U'
    )[0].toUpperCase();

  $('settingsEmail').textContent=
    user.email||
    '—';

  const month=
    currentMonth();

  $('historyMonth').value=
    month;

  $('calendarMonth').value=
    month;

  $('reportMonth').value=
    month;

  $('agendaDate').value=
    today();

  const cachedConfig=
    await loadConfigFromCache(
      user.uid
    );

  if(cachedConfig){
    state.config=
      cachedConfig;

    const cachedMonth=
      await loadMonthFromCache(
        user.uid,
        month
      );

    state.months[month]=
      cachedMonth||
      emptyMonth();

    renderCore();
  }

  try{
    state.config=
      await loadConfig(
        user.uid
      );

    state.months[month]=
      await loadMonth(
        user.uid,
        month
      );

    state.loadedServer.add(
      month
    );

    cleanupLegacyCache(
      user.uid
    );

    renderCore();

    const previous=
      shiftMonth(
        month,
        -1
      );

    setTimeout(
      async()=>{
        try{
          state.months[previous]=
            await loadMonth(
              user.uid,
              previous
            );

          state.loadedServer.add(
            previous
          );

          if(
            state.activePage==='reports'
          ){
            renderReports();
          }

        }catch{}
      },
      350
    );

  }catch(error){
    console.error(error);

    if(!state.config){
      throw error;
    }

    toast(
      'Se mostró la copia local; no se pudo actualizar Firebase.',
      'error'
    );
  }

  $('bootScreen')
    .classList.add(
      'hidden'
    );

  state.booted=true;

  applyPreferenceUI();

  const savedPage=
    sessionStorage.getItem(
      'worklog_active_page'
    );

  if(
    savedPage&&
    savedPage!=='dashboard'
  ){
    openPage(
      savedPage
    );
  }

  lockIfNeeded();
}

async function initialize(){
  setupStaticEvents();

  $('todayText').textContent=
    new Intl.DateTimeFormat(
      'es-EC',
      {
        weekday:'long',
        day:'numeric',
        month:'long',
        year:'numeric'
      }
    ).format(
      new Date()
    );

  const h=
    new Date().getHours();

  $('welcomeTitle').textContent=
    `${
      h<12
      ?'Buenos días'
      :h<19
        ?'Buenas tardes'
        :'Buenas noches'
    } 👋`;

  let resolved=false;

  setTimeout(
    ()=>{
      if(!resolved){
        showFatal(
          'Firebase está tardando demasiado en responder. Revisa tu conexión y vuelve a intentar.'
        );
      }
    },
    15000
  );

  await watchAuth(
    async user=>{
      resolved=true;

      hideFatal();

      $('bootScreen')
        .classList.add(
          'hidden'
        );

      state.user=user;

      if(!user){
        state.user=null;
        state.access=null;
        state.config=null;
        state.months={};

        state.loadedServer.clear();

        state.booted=false;

        $('appScreen')
          .classList.add(
            'hidden'
          );

        $('authScreen')
          .classList.remove(
            'hidden'
          );

        $('pinLock')
          .classList.add(
            'hidden'
          );

        if(
          state.pendingAuthMessage
        ){
          showAuthMessage(
            state.pendingAuthMessage
          );

          state.pendingAuthMessage='';

        }else{
          clearAuthMessage();
        }

        return;
      }

      try{
        const allowed=
          await verifyUserAccess(
            user
          );

        if(!allowed){
          return;
        }

        await bootUser(user);

      }catch(error){
        console.error(error);

        showFatal(
          error.message||
          'No pudimos cargar tus datos.'
        );
      }
    }
  );
}

window.addEventListener(
  'error',
  event=>{
    console.error(
      'WorkLog error:',
      event.error||
      event.message
    );

    if(state.booted){
      toast(
        'Ocurrió un error inesperado. La aplicación sigue activa.',
        'error'
      );
    }
  }
);

window.addEventListener(
  'unhandledrejection',
  event=>{
    console.error(
      'WorkLog promise error:',
      event.reason
    );

    if(state.booted){
      toast(
        event.reason?.message||
        'Una operación no pudo completarse.',
        'error'
      );
    }
  }
);

window.addEventListener(
  'beforeunload',
  event=>{
    if(
      getSyncSnapshot().pending>0
    ){
      event.preventDefault();
      event.returnValue='';
    }
  }
);

initialize()
  .catch(
    error=>
      showFatal(
        error.message
      )
  );