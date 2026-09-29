export const $=id=>document.getElementById(id);

export const $$=selector=>[
  ...document.querySelectorAll(selector)
];


/* =========================================================
   DISPOSITIVO / VIEWPORT
   ========================================================= */

export function isMobileViewport(){
  return window.matchMedia(
    '(max-width:850px), (hover:none) and (pointer:coarse)'
  ).matches;
}


/* =========================================================
   TEXTO / SEGURIDAD
   ========================================================= */

export function escapeHtml(value=''){
  return String(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}

export function normalizeSearch(value=''){
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .trim();
}


/* =========================================================
   FECHAS
   ========================================================= */

export function localDate(date=new Date()){
  const d=new Date(date);

  const year=d.getFullYear();

  const month=
    String(
      d.getMonth()+1
    ).padStart(2,'0');

  const day=
    String(
      d.getDate()
    ).padStart(2,'0');

  return `${year}-${month}-${day}`;
}

export function localTime(date=new Date()){
  const d=new Date(date);

  return `${
    String(
      d.getHours()
    ).padStart(2,'0')
  }:${
    String(
      d.getMinutes()
    ).padStart(2,'0')
  }`;
}

export function currentMonth(date=new Date()){
  return localDate(date).slice(0,7);
}

export function shiftMonth(month,offset){
  const [year,monthNumber]=
    String(month)
      .split('-')
      .map(Number);

  if(
    !Number.isFinite(year)||
    !Number.isFinite(monthNumber)
  ){
    return currentMonth();
  }

  const date=
    new Date(
      year,
      monthNumber-1+offset,
      1,
      12,
      0,
      0
    );

  return `${
    date.getFullYear()
  }-${
    String(
      date.getMonth()+1
    ).padStart(2,'0')
  }`;
}

export function nextDate(date,days=1){
  const parsed=
    new Date(
      `${date}T12:00:00`
    );

  if(
    Number.isNaN(
      parsed.getTime()
    )
  ){
    return localDate();
  }

  parsed.setDate(
    parsed.getDate()+days
  );

  return localDate(parsed);
}

export function formatDate(
  date,
  options={
    day:'2-digit',
    month:'short',
    year:'numeric'
  }
){
  if(!date){
    return '—';
  }

  const parsed=
    new Date(
      `${date}T12:00:00`
    );

  if(
    Number.isNaN(
      parsed.getTime()
    )
  ){
    return '—';
  }

  return new Intl.DateTimeFormat(
    'es-EC',
    options
  ).format(parsed);
}

export function formatMonth(month){
  if(!month){
    return '';
  }

  const [year,monthNumber]=
    String(month)
      .split('-')
      .map(Number);

  if(
    !Number.isFinite(year)||
    !Number.isFinite(monthNumber)
  ){
    return '';
  }

  return new Intl.DateTimeFormat(
    'es-EC',
    {
      month:'long',
      year:'numeric'
    }
  ).format(
    new Date(
      year,
      monthNumber-1,
      1,
      12
    )
  );
}


/* =========================================================
   DINERO
   ========================================================= */

export function moneyFromCents(cents){
  return new Intl.NumberFormat(
    'es-EC',
    {
      style:'currency',
      currency:'USD'
    }
  ).format(
    Number(cents||0)/100
  );
}

export function parseMoneyToCents(value){
  let text=
    String(
      value??''
    )
      .trim()
      .replace(/\s/g,'')
      .replace(/[$]/g,'');

  if(!text){
    return 0;
  }

  /*
    Permite:
    10.50
    10,50
    1,250.50
    1.250,50
  */

  const lastComma=
    text.lastIndexOf(',');

  const lastDot=
    text.lastIndexOf('.');

  if(
    lastComma!==-1&&
    lastDot!==-1
  ){
    if(lastComma>lastDot){
      text=
        text
          .replace(/\./g,'')
          .replace(',','.');
    }else{
      text=
        text.replace(/,/g,'');
    }

  }else if(lastComma!==-1){
    const decimals=
      text.length-lastComma-1;

    if(decimals<=2){
      text=
        text
          .replace(/\./g,'')
          .replace(',','.');
    }else{
      text=
        text.replace(/,/g,'');
    }

  }else{
    const parts=
      text.split('.');

    if(parts.length>2){
      const decimal=
        parts.pop();

      text=
        parts.join('')+
        '.'+
        decimal;
    }
  }

  text=
    text.replace(
      /[^0-9.-]/g,
      ''
    );

  if(!text){
    return 0;
  }

  const number=
    Number(text);

  if(
    !Number.isFinite(number)||
    number<0
  ){
    throw new Error(
      'El valor ingresado no es válido.'
    );
  }

  return Math.round(
    number*100
  );
}

export function centsToInput(cents){
  const value=
    Number(cents||0)/100;

  return value
    ?value.toFixed(2)
    :'';
}


/* =========================================================
   DEBOUNCE
   ========================================================= */

export function debounce(fn,wait=180){
  let timer=null;

  return function(...args){
    const context=this;

    clearTimeout(timer);

    timer=
      setTimeout(
        ()=>{
          fn.apply(
            context,
            args
          );
        },
        wait
      );
  };
}


/* =========================================================
   TOASTS
   ========================================================= */

export function toast(
  message,
  type='success',
  action=null
){
  const container=
    $('toastContainer');

  if(!container){
    console.warn(
      'Toast:',
      message
    );

    return;
  }

  /*
    Evita llenar la pantalla
    de mensajes.
  */

  const current=
    [
      ...container.querySelectorAll(
        '.toast'
      )
    ];

  while(current.length>=4){
    current.shift()?.remove();
  }

  const item=
    document.createElement(
      'div'
    );

  item.className=
    `toast ${type}`;

  item.setAttribute(
    'role',
    type==='error'
      ?'alert'
      :'status'
  );

  item.setAttribute(
    'aria-live',
    type==='error'
      ?'assertive'
      :'polite'
  );

  const span=
    document.createElement(
      'span'
    );

  span.textContent=
    String(message||'');

  item.appendChild(span);

  if(
    action?.label&&
    typeof action.onClick==='function'
  ){
    const button=
      document.createElement(
        'button'
      );

    button.type='button';

    button.textContent=
      action.label;

    button.addEventListener(
      'click',
      ()=>{
        try{
          action.onClick();
        }finally{
          item.remove();
        }
      }
    );

    item.appendChild(button);
  }

  container.appendChild(item);

  /*
    Animación de entrada.
  */

  requestAnimationFrame(()=>{
    item.classList.add(
      'visible'
    );
  });

  const duration=
    action
      ?6500
      :type==='error'
        ?5000
        :3500;

  const timer=
    setTimeout(
      ()=>{
        item.classList.remove(
          'visible'
        );

        setTimeout(
          ()=>item.remove(),
          180
        );
      },
      duration
    );

  item.addEventListener(
    'mouseenter',
    ()=>{
      clearTimeout(timer);
    },
    {
      once:true
    }
  );
}


/* =========================================================
   AUTENTICACIÓN - MENSAJES
   ========================================================= */

export function showAuthMessage(
  message,
  type='error'
){
  const box=
    $('authMessage');

  if(!box){
    return;
  }

  box.className=
    `message ${type}`;

  box.textContent=
    message;
}

export function clearAuthMessage(){
  const box=
    $('authMessage');

  if(!box){
    return;
  }

  box.className=
    'message hidden';

  box.textContent='';
}


/* =========================================================
   MODALES
   ========================================================= */

const openModals=
  new Set();

const previousFocus=
  new Map();

let scrollPosition=0;

function lockPageScroll(){
  if(openModals.size!==1){
    return;
  }

  scrollPosition=
    window.scrollY||
    window.pageYOffset||
    0;

  document.body.classList.add(
    'modal-open'
  );

  /*
    En móvil evitamos que el contenido
    del fondo se mueva.
  */

  if(isMobileViewport()){
    document.body.style.overflow=
      'hidden';

    document.body.style.touchAction=
      'none';
  }
}

function unlockPageScroll(){
  if(openModals.size>0){
    return;
  }

  document.body.classList.remove(
    'modal-open'
  );

  document.body.style.overflow='';
  document.body.style.touchAction='';
}

export function openModal(id){
  const element=$(id);

  if(!element){
    console.warn(
      `No existe el modal: ${id}`
    );

    return;
  }

  if(
    document.activeElement instanceof HTMLElement
  ){
    previousFocus.set(
      id,
      document.activeElement
    );
  }

  element.classList.add(
    'show'
  );

  element.setAttribute(
    'aria-hidden',
    'false'
  );

  openModals.add(id);

  lockPageScroll();

  /*
    En computadora enfocamos el
    primer campo automáticamente.

    En celular NO lo hacemos porque
    abriría inmediatamente el teclado
    y taparía media pantalla.
  */

  setTimeout(
    ()=>{
      if(isMobileViewport()){
        element
          .querySelector(
            '.modal-head button, [data-close-modal]'
          )
          ?.focus?.();

        return;
      }

      const target=
        element.querySelector(
          [
            'input:not([type="hidden"]):not([disabled])',
            'select:not([disabled])',
            'textarea:not([disabled])',
            'button:not([disabled])'
          ].join(',')
        );

      target?.focus?.();
    },
    40
  );
}

export function closeModal(id){
  const element=$(id);

  if(!element){
    return;
  }

  element.classList.remove(
    'show'
  );

  element.setAttribute(
    'aria-hidden',
    'true'
  );

  openModals.delete(id);

  unlockPageScroll();

  const oldFocus=
    previousFocus.get(id);

  previousFocus.delete(id);

  if(
    oldFocus&&
    document.contains(oldFocus)
  ){
    setTimeout(
      ()=>{
        oldFocus.focus?.({
          preventScroll:true
        });
      },
      40
    );
  }
}


/* =========================================================
   CONFIRMACIÓN PERSONALIZADA
   ========================================================= */

let confirmResolver=null;

let confirmInitialized=false;

function resolveConfirmation(value){
  const resolver=
    confirmResolver;

  confirmResolver=null;

  closeModal(
    'confirmModal'
  );

  resolver?.(value);
}

export function confirmAction(
  title,
  text,
  {
    danger=true,
    okLabel='Confirmar'
  }={}
){
  const modal=
    $('confirmModal');

  if(!modal){
    return Promise.resolve(
      window.confirm(text)
    );
  }

  /*
    Si había una confirmación anterior
    todavía abierta, la cancelamos.
  */

  if(confirmResolver){
    const old=
      confirmResolver;

    confirmResolver=null;

    old(false);
  }

  $('confirmTitle').textContent=
    title;

  $('confirmText').textContent=
    text;

  $('confirmOk').textContent=
    okLabel;

  $('confirmOk').className=
    `button ${
      danger
        ?'button-danger'
        :'button-primary'
    }`;

  openModal(
    'confirmModal'
  );

  return new Promise(
    resolve=>{
      confirmResolver=
        resolve;
    }
  );
}

export function setupConfirmModal(){
  if(confirmInitialized){
    return;
  }

  const modal=
    $('confirmModal');

  const cancel=
    $('confirmCancel');

  const ok=
    $('confirmOk');

  if(
    !modal||
    !cancel||
    !ok
  ){
    console.warn(
      'El modal de confirmación no está completo.'
    );

    return;
  }

  confirmInitialized=true;

  cancel.addEventListener(
    'click',
    ()=>{
      resolveConfirmation(false);
    }
  );

  ok.addEventListener(
    'click',
    ()=>{
      resolveConfirmation(true);
    }
  );

  modal.addEventListener(
    'click',
    event=>{
      if(event.target===modal){
        resolveConfirmation(false);
      }
    }
  );

  document.addEventListener(
    'keydown',
    event=>{
      if(
        event.key==='Escape'&&
        modal.classList.contains('show')
      ){
        event.preventDefault();

        resolveConfirmation(false);
      }
    }
  );
}


/* =========================================================
   DESCARGAS
   ========================================================= */

export function downloadText(
  filename,
  text,
  type='text/plain;charset=utf-8'
){
  try{
    const blob=
      new Blob(
        [text],
        {type}
      );

    const url=
      URL.createObjectURL(
        blob
      );

    const anchor=
      document.createElement(
        'a'
      );

    anchor.href=url;

    anchor.download=
      filename;

    anchor.style.display=
      'none';

    document.body.appendChild(
      anchor
    );

    anchor.click();

    anchor.remove();

    /*
      En algunos navegadores móviles
      revocar inmediatamente puede
      cancelar la descarga.
    */

    setTimeout(
      ()=>{
        URL.revokeObjectURL(
          url
        );
      },
      1500
    );

  }catch(error){
    console.error(
      'Error descargando archivo:',
      error
    );

    throw new Error(
      'No se pudo preparar la descarga.'
    );
  }
}


/* =========================================================
   CSV
   ========================================================= */

export function toCSV(rows){
  return rows
    .map(
      row=>
        row
          .map(
            value=>
              `"${String(
                value??''
              ).replaceAll(
                '"',
                '""'
              )}"`
          )
          .join(',')
    )
    .join('\r\n');
}

function detectCSVDelimiter(text){
  const firstLine=
    String(text)
      .replace(/^\uFEFF/,'')
      .split(/\r?\n/)[0]||
    '';

  let comma=0;
  let semicolon=0;
  let quoted=false;

  for(
    let i=0;
    i<firstLine.length;
    i++
  ){
    const char=
      firstLine[i];

    if(char==='"'){
      if(
        quoted&&
        firstLine[i+1]==='"'
      ){
        i++;
      }else{
        quoted=!quoted;
      }

      continue;
    }

    if(quoted){
      continue;
    }

    if(char===','){
      comma++;
    }

    if(char===';'){
      semicolon++;
    }
  }

  return semicolon>comma
    ?';'
    :',';
}

export function parseCSV(text){
  const source=
    String(text||'')
      .replace(/^\uFEFF/,'');

  if(!source.trim()){
    return [];
  }

  const delimiter=
    detectCSVDelimiter(
      source
    );

  const rows=[];

  let row=[];
  let cell='';
  let quoted=false;

  for(
    let i=0;
    i<source.length;
    i++
  ){
    const char=
      source[i];

    if(quoted){

      if(
        char==='"'&&
        source[i+1]==='"'
      ){
        cell+='"';
        i++;

      }else if(
        char==='"'
      ){
        quoted=false;

      }else{
        cell+=char;
      }

      continue;
    }

    if(char==='"'){
      quoted=true;

    }else if(
      char===delimiter
    ){
      row.push(cell);
      cell='';

    }else if(
      char==='\n'
    ){
      row.push(
        cell.replace(
          /\r$/,
          ''
        )
      );

      rows.push(row);

      row=[];
      cell='';

    }else{
      cell+=char;
    }
  }

  if(
    cell.length||
    row.length
  ){
    row.push(
      cell.replace(
        /\r$/,
        ''
      )
    );

    rows.push(row);
  }

  return rows.filter(
    row=>
      row.some(
        value=>
          String(value)
            .trim()!==''
      )
  );
}


/* =========================================================
   HASH PIN LOCAL
   ========================================================= */

export async function hashText(value){
  if(
    !window.crypto?.subtle
  ){
    throw new Error(
      'El navegador no permite proteger el PIN en este contexto. Abre WorkLog mediante HTTPS o localhost.'
    );
  }

  const data=
    new TextEncoder()
      .encode(
        String(value)
      );

  const hash=
    await crypto.subtle.digest(
      'SHA-256',
      data
    );

  return [
    ...new Uint8Array(hash)
  ]
    .map(
      byte=>
        byte
          .toString(16)
          .padStart(2,'0')
    )
    .join('');
}


/* =========================================================
   SEMANAS
   ========================================================= */

export function startOfWeek(
  date=localDate()
){
  const parsed=
    new Date(
      `${date}T12:00:00`
    );

  if(
    Number.isNaN(
      parsed.getTime()
    )
  ){
    return localDate();
  }

  const day=
    (
      parsed.getDay()+6
    )%7;

  parsed.setDate(
    parsed.getDate()-day
  );

  return localDate(parsed);
}

export function endOfWeek(
  date=localDate()
){
  const parsed=
    new Date(
      `${
        startOfWeek(date)
      }T12:00:00`
    );

  parsed.setDate(
    parsed.getDate()+6
  );

  return localDate(parsed);
}


/* =========================================================
   CALENDARIO
   ========================================================= */

export function daysInMonth(month){
  const [year,monthNumber]=
    String(month)
      .split('-')
      .map(Number);

  if(
    !Number.isFinite(year)||
    !Number.isFinite(monthNumber)
  ){
    return 30;
  }

  return new Date(
    year,
    monthNumber,
    0,
    12
  ).getDate();
}

export function monthGrid(month){
  const [year,monthNumber]=
    String(month)
      .split('-')
      .map(Number);

  if(
    !Number.isFinite(year)||
    !Number.isFinite(monthNumber)
  ){
    return [];
  }

  const first=
    new Date(
      year,
      monthNumber-1,
      1,
      12
    );

  /*
    Convertimos:
    domingo 0
    lunes 1
    ...

    a calendario que empieza lunes.
  */

  const offset=
    (
      first.getDay()+6
    )%7;

  const previous=
    shiftMonth(
      month,
      -1
    );

  const next=
    shiftMonth(
      month,
      1
    );

  const previousDays=
    daysInMonth(
      previous
    );

  const currentDays=
    daysInMonth(
      month
    );

  const cells=[];

  for(
    let i=offset-1;
    i>=0;
    i--
  ){
    cells.push({
      date:
        `${previous}-${
          String(
            previousDays-i
          ).padStart(
            2,
            '0'
          )
        }`,

      outside:true
    });
  }

  for(
    let day=1;
    day<=currentDays;
    day++
  ){
    cells.push({
      date:
        `${month}-${
          String(day)
            .padStart(
              2,
              '0'
            )
        }`,

      outside:false
    });
  }

  let nextDay=1;

  while(
    cells.length%7!==0||
    cells.length<42
  ){
    cells.push({
      date:
        `${next}-${
          String(
            nextDay++
          ).padStart(
            2,
            '0'
          )
        }`,

      outside:true
    });
  }

  return cells;
}


/* =========================================================
   BOTONES OCUPADOS
   ========================================================= */

export function setButtonBusy(
  button,
  busy,
  label='Guardando...'
){
  if(!button){
    return;
  }

  if(busy){

    if(
      button.dataset.busy==='true'
    ){
      return;
    }

    button.dataset.busy=
      'true';

    button.dataset.originalText=
      button.textContent;

    button.textContent=
      label;

    button.disabled=
      true;

    button.setAttribute(
      'aria-busy',
      'true'
    );

    button.classList.add(
      'is-busy'
    );

  }else{

    button.textContent=
      button.dataset.originalText||
      button.textContent;

    button.disabled=
      false;

    button.removeAttribute(
      'aria-busy'
    );

    button.classList.remove(
      'is-busy'
    );

    delete button.dataset.busy;
    delete button.dataset.originalText;
  }
}