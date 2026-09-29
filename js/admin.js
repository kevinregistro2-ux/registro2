/* =========================================================
   WORKLOG ADMIN
   ========================================================= */

import {
  initializeApp,
  deleteApp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';

import {
  getAuth,
  setPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  deleteUser,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteField,
  Timestamp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

import {
  auth,
  db,
  firebaseReady
} from './firebase.js';

import {
  firebaseConfig
} from './firebase-config.js';


/* =========================================================
   ESTADO
   ========================================================= */

const state={
  admin:null,
  accounts:[],
  filteredAccounts:[],
  selectedAccount:null,
  loading:false
};


/* =========================================================
   DOM
   ========================================================= */

function $(id){
  return document.getElementById(id);
}


function show(element){
  if(!element)return;

  element.classList.remove(
    'admin-hidden'
  );
}


function hide(element){
  if(!element)return;

  element.classList.add(
    'admin-hidden'
  );
}


/* =========================================================
   TEXTO
   ========================================================= */

function safeString(value){
  return typeof value==='string'
    ?value
    :'';
}


function escapeHtml(value=''){
  return safeString(value)
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;');
}


function normalizeText(value=''){
  return safeString(value)
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      ''
    )
    .toLowerCase()
    .trim();
}


/* =========================================================
   FECHAS
   ========================================================= */

function timestampToDate(value){

  if(!value){
    return null;
  }


  if(
    typeof value.toDate===
    'function'
  ){
    return value.toDate();
  }


  if(
    value instanceof Date
  ){
    return value;
  }


  return null;
}


function formatDateTime(value){

  const date=
    timestampToDate(value);


  if(
    !date||
    Number.isNaN(
      date.getTime()
    )
  ){
    return '—';
  }


  return new Intl.DateTimeFormat(
    'es-EC',
    {
      dateStyle:'medium',
      timeStyle:'short'
    }
  ).format(date);
}


function nowTimestamp(){
  return Timestamp.now();
}


function futureTimestamp(days){

  const date=
    new Date();

  date.setDate(
    date.getDate()+days
  );


  return Timestamp.fromDate(
    date
  );
}


/* =========================================================
   TOAST
   ========================================================= */

function toast(
  message,
  type=''
){

  const container=
    $('adminToastContainer');


  if(!container){
    return;
  }


  const item=
    document.createElement(
      'div'
    );


  item.className=
    `admin-toast ${type}`;


  item.textContent=
    message;


  container.appendChild(
    item
  );


  while(
    container.children.length>4
  ){
    container.firstElementChild
      ?.remove();
  }


  window.setTimeout(
    ()=>{
      item.remove();
    },
    4200
  );
}


/* =========================================================
   BOTONES OCUPADOS
   ========================================================= */

function setBusy(
  button,
  busy,
  text='Procesando...'
){

  if(!button){
    return;
  }


  if(busy){

    if(
      !button.dataset.originalText
    ){
      button.dataset.originalText=
        button.textContent;
    }


    button.disabled=true;

    button.textContent=
      text;

  }else{

    button.disabled=false;

    if(
      button.dataset.originalText
    ){
      button.textContent=
        button.dataset.originalText;

      delete button.dataset.originalText;
    }
  }
}


/* =========================================================
   MODALES
   ========================================================= */

function openAdminModal(id){

  const modal=$(id);

  if(!modal){
    return;
  }


  modal.classList.add(
    'show'
  );


  document.body.style.overflow=
    'hidden';
}


function closeAdminModal(id){

  const modal=$(id);

  if(!modal){
    return;
  }


  modal.classList.remove(
    'show'
  );


  if(
    !document.querySelector(
      '.admin-modal-backdrop.show'
    )
  ){
    document.body.style.overflow=
      '';
  }
}


/* =========================================================
   CONFIRMACIÓN
   ========================================================= */

let confirmResolver=null;


function confirmAdmin(
  title,
  text,
  dangerText='Confirmar'
){

  $('adminConfirmTitle').textContent=
    title;

  $('adminConfirmText').textContent=
    text;

  $('adminConfirmOk').textContent=
    dangerText;


  openAdminModal(
    'adminConfirmModal'
  );


  return new Promise(resolve=>{

    confirmResolver=
      resolve;

  });
}


function resolveConfirmation(
  result
){

  closeAdminModal(
    'adminConfirmModal'
  );


  if(confirmResolver){

    const resolver=
      confirmResolver;

    confirmResolver=null;

    resolver(result);
  }
}


/* =========================================================
   MENSAJES LOGIN
   ========================================================= */

function setLoginMessage(
  message='',
  type=''
){

  const box=
    $('adminLoginMessage');


  if(!box){
    return;
  }


  if(!message){

    box.textContent='';

    box.className=
      'admin-login-message admin-hidden';

    return;
  }


  box.textContent=
    message;


  box.className=
    `admin-login-message ${type}`;
}


/* =========================================================
   ERRORES FIREBASE
   ========================================================= */

function firebaseErrorMessage(
  error
){

  const code=
    error?.code||'';


  const messages={

    'auth/invalid-credential':
      'Correo o contraseña incorrectos.',

    'auth/invalid-email':
      'El correo electrónico no es válido.',

    'auth/user-disabled':
      'Esta cuenta está deshabilitada en Firebase Authentication.',

    'auth/too-many-requests':
      'Se realizaron demasiados intentos. Intenta nuevamente más tarde.',

    'auth/network-request-failed':
      'No se pudo conectar con Firebase. Revisa tu conexión.',

    'auth/email-already-in-use':
      'Ya existe una cuenta con ese correo electrónico.',

    'auth/weak-password':
      'La contraseña es demasiado débil.',

    'auth/operation-not-allowed':
      'El inicio de sesión por correo y contraseña no está habilitado.',

    'permission-denied':
      'Firebase rechazó la operación por permisos.',

    'firestore/permission-denied':
      'Firebase rechazó la operación por permisos.',

    'unavailable':
      'Firebase no está disponible temporalmente.',

    'firestore/unavailable':
      'Firebase no está disponible temporalmente.'
  };


  return (
    messages[code]
    ||
    error?.message
    ||
    'Ocurrió un error inesperado.'
  );
}


/* =========================================================
   ESTADO DE CUENTA
   ========================================================= */

function getAccountStatus(
  account
){

  if(
    account.disabledForever===true
    ||
    account.active===false
  ){
    return {
      id:'blocked',
      label:'Bloqueada'
    };
  }


  const blockedUntil=
    timestampToDate(
      account.blockedUntil
    );


  if(
    blockedUntil&&
    blockedUntil.getTime()>
      Date.now()
  ){
    return {
      id:'suspended',
      label:'Suspendida'
    };
  }


  return {
    id:'active',
    label:'Activa'
  };
}


/* =========================================================
   AUTORIZACIÓN ADMIN
   ========================================================= */

async function isAuthorizedAdmin(
  uid
){

  const snapshot=
    await getDoc(
      doc(
        db,
        'admins',
        uid
      )
    );


  return snapshot.exists();
}


/* =========================================================
   PANTALLAS
   ========================================================= */

function showLoginScreen(){

  hide(
    $('adminBoot')
  );

  hide(
    $('adminDeniedScreen')
  );

  hide(
    $('adminApp')
  );

  show(
    $('adminLoginScreen')
  );
}


function showDeniedScreen(){

  hide(
    $('adminBoot')
  );

  hide(
    $('adminLoginScreen')
  );

  hide(
    $('adminApp')
  );

  show(
    $('adminDeniedScreen')
  );
}


function showAdminScreen(){

  hide(
    $('adminBoot')
  );

  hide(
    $('adminLoginScreen')
  );

  hide(
    $('adminDeniedScreen')
  );

  show(
    $('adminApp')
  );
}


/* =========================================================
   LOGIN
   ========================================================= */

async function handleAdminLogin(
  event
){

  event.preventDefault();


  const email=
    $('adminEmail')
      .value
      .trim()
      .toLowerCase();


  const password=
    $('adminPassword')
      .value;


  if(
    !email||
    !password
  ){

    setLoginMessage(
      'Completa el correo y la contraseña.',
      'error'
    );

    return;
  }


  const button=
    $('adminLoginBtn');


  setBusy(
    button,
    true,
    'Ingresando...'
  );


  setLoginMessage();


  try{

    await firebaseReady;


    const credential=
      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );


    const authorized=
      await isAuthorizedAdmin(
        credential.user.uid
      );


    if(!authorized){

      showDeniedScreen();

      return;
    }


    state.admin=
      credential.user;


    await enterAdmin();

  }catch(error){

    console.error(
      'Error de login admin:',
      error
    );


    setLoginMessage(
      firebaseErrorMessage(
        error
      ),
      'error'
    );


    showLoginScreen();

  }finally{

    setBusy(
      button,
      false
    );
  }
}


/* =========================================================
   ENTRAR AL PANEL
   ========================================================= */

async function enterAdmin(){

  if(!state.admin){
    return;
  }


  $('adminCurrentEmail').textContent=
    state.admin.email
    ||
    state.admin.uid;


  showAdminScreen();


  await loadAccounts();
}


/* =========================================================
   CARGAR CUENTAS
   ========================================================= */

async function loadAccounts(){

  if(state.loading){
    return;
  }


  state.loading=true;


  show(
    $('adminLoadingList')
  );

  hide(
    $('adminAccountList')
  );

  hide(
    $('adminEmpty')
  );


  $('adminAccountCountText').textContent=
    'Cargando cuentas...';


  try{

    const snapshot=
      await getDocs(
        collection(
          db,
          'userAccess'
        )
      );


    state.accounts=
      snapshot.docs.map(
        item=>({
          uid:item.id,
          ...item.data()
        })
      );


    state.accounts.sort(
      (a,b)=>{

        const aDate=
          timestampToDate(
            a.createdAt
          )?.getTime()||0;


        const bDate=
          timestampToDate(
            b.createdAt
          )?.getTime()||0;


        return bDate-aDate;
      }
    );


    applyFilters();

  }catch(error){

    console.error(
      'Error cargando cuentas:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );


    $('adminAccountCountText').textContent=
      'No se pudieron cargar las cuentas.';

  }finally{

    state.loading=false;

    hide(
      $('adminLoadingList')
    );
  }
}


/* =========================================================
   FILTROS
   ========================================================= */

function applyFilters(){

  const search=
    normalizeText(
      $('adminSearch')?.value
    );


  const statusFilter=
    $('adminStatusFilter')
      ?.value
      ||'';


  state.filteredAccounts=
    state.accounts.filter(
      account=>{

        const status=
          getAccountStatus(
            account
          );


        if(
          statusFilter&&
          status.id!==statusFilter
        ){
          return false;
        }


        if(!search){
          return true;
        }


        const content=
          normalizeText(
            [
              account.displayName,
              account.email,
              account.uid,
              account.role
            ].join(' ')
          );


        return content.includes(
          search
        );
      }
    );


  renderAccounts();

  renderStats();
}


/* =========================================================
   ESTADÍSTICAS
   ========================================================= */

function renderStats(){

  let active=0;
  let suspended=0;
  let blocked=0;


  for(
    const account of state.accounts
  ){

    const status=
      getAccountStatus(
        account
      );


    if(status.id==='active'){
      active++;
    }

    if(status.id==='suspended'){
      suspended++;
    }

    if(status.id==='blocked'){
      blocked++;
    }
  }


  $('adminStatTotal').textContent=
    String(
      state.accounts.length
    );


  $('adminStatActive').textContent=
    String(active);


  $('adminStatSuspended').textContent=
    String(suspended);


  $('adminStatBlocked').textContent=
    String(blocked);
}


/* =========================================================
   RENDER CUENTAS
   ========================================================= */

function renderAccounts(){

  const list=
    $('adminAccountList');


  if(!list){
    return;
  }


  const accounts=
    state.filteredAccounts;


  $('adminAccountCountText').textContent=
    accounts.length===1
      ?'1 cuenta mostrada'
      :`${accounts.length} cuentas mostradas`;


  if(!accounts.length){

    list.innerHTML='';

    hide(list);

    show(
      $('adminEmpty')
    );

    return;
  }


  hide(
    $('adminEmpty')
  );

  show(list);


  list.innerHTML=
    accounts.map(
      account=>{

        const status=
          getAccountStatus(
            account
          );


        const name=
          account.displayName
          ||
          'Sin nombre';


        const email=
          account.email
          ||
          'Sin correo registrado';


        const role=
          account.role
          ||
          'user';


        let restriction='Sin restricción';


        if(
          status.id==='suspended'
        ){
          restriction=
            `Hasta ${formatDateTime(
              account.blockedUntil
            )}`;
        }


        if(
          status.id==='blocked'
        ){
          restriction=
            'Bloqueo indefinido';
        }


        const isCurrent=
          account.uid===
          state.admin?.uid;


        return `
          <article
            class="admin-user-card"
            data-admin-user="${escapeHtml(account.uid)}"
          >

            <div class="admin-user-main">

              <strong>
                ${escapeHtml(name)}
                ${isCurrent?' · Tú':''}
              </strong>

              <span>
                ${escapeHtml(email)}
              </span>

              <span>
                UID:
                ${escapeHtml(account.uid)}
              </span>

            </div>


            <div class="admin-user-meta">

              <span>
                Rol
              </span>

              <strong>
                ${escapeHtml(role)}
              </strong>

              <span
                style="margin-top:7px;"
              >
                ${escapeHtml(restriction)}
              </span>

            </div>


            <div class="admin-user-status-wrap">

              <span
                class="admin-status ${status.id}"
              >
                ${status.label}
              </span>

            </div>


            <div class="admin-user-actions">

              <button
                class="button button-ghost button-small"
                type="button"
                data-manage-user="${escapeHtml(account.uid)}"
              >
                Gestionar
              </button>

            </div>

          </article>
        `;
      }
    )
    .join('');
}


/* =========================================================
   BUSCAR CUENTA
   ========================================================= */

function getAccountByUid(
  uid
){

  return state.accounts.find(
    account=>
      account.uid===uid
  )||null;
}


/* =========================================================
   ABRIR GESTIÓN
   ========================================================= */

function openManageAccount(
  uid
){

  const account=
    getAccountByUid(
      uid
    );


  if(!account){

    toast(
      'No se encontró esa cuenta.',
      'error'
    );

    return;
  }


  state.selectedAccount=
    account;


  $('adminManageUid').value=
    account.uid;


  $('adminManageName').textContent=
    account.displayName
    ||
    'Sin nombre';


  $('adminManageEmail').textContent=
    account.email
    ||
    'Sin correo registrado';


  $('adminManageUidText').textContent=
    `UID: ${account.uid}`;


  $('adminNote').value=
    account.adminNote
    ||
    '';


  $('adminBlockedUntil').value=
    '';


  renderManageStatus(
    account
  );


  openAdminModal(
    'adminManageModal'
  );
}


/* =========================================================
   ESTADO DENTRO DEL MODAL
   ========================================================= */

function renderManageStatus(
  account
){

  const status=
    getAccountStatus(
      account
    );


  const element=
    $('adminManageStatus');


  element.className=
    `admin-status ${status.id}`;


  if(
    status.id==='suspended'
  ){

    element.textContent=
      `Suspendida hasta ${formatDateTime(
        account.blockedUntil
      )}`;

  }else{

    element.textContent=
      status.label;
  }
}


/* =========================================================
   ACTUALIZACIÓN LOCAL
   ========================================================= */

function applyLocalPatch(
  uid,
  patch={},
  remove=[]
){

  const index=
    state.accounts.findIndex(
      account=>
        account.uid===uid
    );


  if(index<0){
    return;
  }


  const current={
    ...state.accounts[index],
    ...patch
  };


  for(const key of remove){
    delete current[key];
  }


  state.accounts[index]=
    current;


  if(
    state.selectedAccount?.uid===
    uid
  ){
    state.selectedAccount=
      current;

    renderManageStatus(
      current
    );
  }


  applyFilters();
}


/* =========================================================
   ESCRIBIR ESTADO
   ========================================================= */

async function updateAccountAccess(
  uid,
  patch,
  removeFields=[],
  successMessage='Cuenta actualizada.'
){

  if(!uid){
    return;
  }


  const ref=
    doc(
      db,
      'userAccess',
      uid
    );


  const firestorePatch={
    ...patch,
    updatedAt:
      nowTimestamp()
  };


  for(
    const field of removeFields
  ){
    firestorePatch[field]=
      deleteField();
  }


  await updateDoc(
    ref,
    firestorePatch
  );


  const localPatch={
    ...patch,
    updatedAt:
      firestorePatch.updatedAt
  };


  applyLocalPatch(
    uid,
    localPatch,
    removeFields
  );


  toast(
    successMessage,
    'success'
  );
}


/* =========================================================
   SUSPENDER
   ========================================================= */

async function suspendSelected(
  days
){

  const account=
    state.selectedAccount;


  if(!account){
    return;
  }


  const confirmed=
    await confirmAdmin(
      'Suspender cuenta',
      days===1
        ?'La cuenta no podrá utilizar los datos protegidos de WorkLog durante 1 día.'
        :`La cuenta no podrá utilizar los datos protegidos de WorkLog durante ${days} días.`,
      'Suspender'
    );


  if(!confirmed){
    return;
  }


  try{

    await updateAccountAccess(
      account.uid,
      {
        active:true,
        disabledForever:false,
        blockedUntil:
          futureTimestamp(days)
      },
      [],
      days===1
        ?'Cuenta suspendida durante 1 día.'
        :`Cuenta suspendida durante ${days} días.`
    );

  }catch(error){

    console.error(
      'Error suspendiendo cuenta:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   SUSPENSIÓN PERSONALIZADA
   ========================================================= */

async function applyCustomSuspension(){

  const account=
    state.selectedAccount;


  if(!account){
    return;
  }


  const raw=
    $('adminBlockedUntil')
      .value;


  if(!raw){

    toast(
      'Selecciona una fecha y hora.',
      'error'
    );

    return;
  }


  const date=
    new Date(raw);


  if(
    Number.isNaN(
      date.getTime()
    )
  ){

    toast(
      'La fecha seleccionada no es válida.',
      'error'
    );

    return;
  }


  if(
    date.getTime()<=
    Date.now()
  ){

    toast(
      'La suspensión debe terminar en una fecha futura.',
      'error'
    );

    return;
  }


  const confirmed=
    await confirmAdmin(
      'Suspender cuenta',
      `La cuenta quedará suspendida hasta ${new Intl.DateTimeFormat(
        'es-EC',
        {
          dateStyle:'medium',
          timeStyle:'short'
        }
      ).format(date)}.`,
      'Suspender'
    );


  if(!confirmed){
    return;
  }


  try{

    await updateAccountAccess(
      account.uid,
      {
        active:true,
        disabledForever:false,
        blockedUntil:
          Timestamp.fromDate(
            date
          )
      },
      [],
      'Suspensión aplicada.'
    );

  }catch(error){

    console.error(
      'Error aplicando suspensión:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   BLOQUEAR INDEFINIDAMENTE
   ========================================================= */

async function blockForever(){

  const account=
    state.selectedAccount;


  if(!account){
    return;
  }


  const confirmed=
    await confirmAdmin(
      'Bloquear indefinidamente',
      `La cuenta ${account.email||account.uid} dejará de tener acceso a los datos protegidos de WorkLog hasta que la reactives manualmente.`,
      'Bloquear'
    );


  if(!confirmed){
    return;
  }


  try{

    await updateAccountAccess(
      account.uid,
      {
        active:false,
        disabledForever:true
      },
      [
        'blockedUntil'
      ],
      'Cuenta bloqueada indefinidamente.'
    );

  }catch(error){

    console.error(
      'Error bloqueando cuenta:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   REACTIVAR
   ========================================================= */

async function reactivateAccount(){

  const account=
    state.selectedAccount;


  if(!account){
    return;
  }


  try{

    await updateAccountAccess(
      account.uid,
      {
        active:true,
        disabledForever:false
      },
      [
        'blockedUntil'
      ],
      'Cuenta reactivada.'
    );

  }catch(error){

    console.error(
      'Error reactivando cuenta:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   NOTA ADMINISTRATIVA
   ========================================================= */

async function saveAdminNote(){

  const account=
    state.selectedAccount;


  if(!account){
    return;
  }


  const note=
    $('adminNote')
      .value
      .trim()
      .slice(
        0,
        500
      );


  try{

    await updateAccountAccess(
      account.uid,
      {
        adminNote:note
      },
      [],
      'Nota administrativa guardada.'
    );

  }catch(error){

    console.error(
      'Error guardando nota:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   CREAR CUENTA
   ========================================================= */

async function createAccount(
  event
){

  event.preventDefault();


  const name=
    $('adminCreateName')
      .value
      .trim()
      .slice(
        0,
        80
      );


  const email=
    $('adminCreateEmail')
      .value
      .trim()
      .toLowerCase();


  const password=
    $('adminCreatePassword')
      .value;


  const confirmPassword=
    $('adminCreatePasswordConfirm')
      .value;


  if(!email){

    toast(
      'Ingresa un correo electrónico.',
      'error'
    );

    return;
  }


  if(
    password.length<6
  ){

    toast(
      'La contraseña debe tener mínimo 6 caracteres.',
      'error'
    );

    return;
  }


  if(
    password!==confirmPassword
  ){

    toast(
      'Las contraseñas no coinciden.',
      'error'
    );

    return;
  }


  const button=
    $('adminCreateSubmitBtn');


  setBusy(
    button,
    true,
    'Creando...'
  );


  let secondaryApp=null;
  let createdUser=null;


  try{

    /*
      Creamos una aplicación Firebase secundaria.

      Esto es importante porque createUserWithEmailAndPassword
      inicia sesión automáticamente con la cuenta recién creada.

      Al usar una instancia secundaria, la sesión principal
      del administrador NO se reemplaza.
    */

    secondaryApp=
      initializeApp(
        firebaseConfig,
        `worklog-admin-create-${Date.now()}`
      );


    const secondaryAuth=
      getAuth(
        secondaryApp
      );


    /*
      La cuenta temporal creada por el administrador
      nunca se guarda en localStorage/IndexedDB.
    */

    await setPersistence(
      secondaryAuth,
      inMemoryPersistence
    );


    const credential=
      await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        password
      );


    createdUser=
      credential.user;


    if(name){

      await updateProfile(
        createdUser,
        {
          displayName:name
        }
      );
    }


    const accessData={

      email,

      displayName:name,

      active:true,

      disabledForever:false,

      role:'user',

      adminNote:'',

      createdAt:
        nowTimestamp(),

      updatedAt:
        nowTimestamp()
    };


    /*
      Esta escritura utiliza "db", que pertenece
      a la aplicación principal.

      Por tanto, Firestore la recibe autenticada
      con TU cuenta administradora, no con la cuenta
      que acabamos de crear.
    */

    await setDoc(
      doc(
        db,
        'userAccess',
        createdUser.uid
      ),
      accessData
    );


    state.accounts.unshift({
      uid:createdUser.uid,
      ...accessData
    });


    applyFilters();


    $('adminCreateForm')
      .reset();


    closeAdminModal(
      'adminCreateModal'
    );


    toast(
      'Cuenta creada correctamente.',
      'success'
    );


    /*
      Cerramos inmediatamente la sesión secundaria.
    */

    try{

      await signOut(
        secondaryAuth
      );

    }catch{}


  }catch(error){

    console.error(
      'Error creando cuenta:',
      error
    );


    /*
      Si Firebase Auth alcanzó a crear la cuenta pero
      Firestore rechazó userAccess, intentamos revertir
      la creación para no dejar una cuenta huérfana.
    */

    if(createdUser){

      try{

        await deleteUser(
          createdUser
        );

      }catch(rollbackError){

        console.error(
          'No se pudo revertir la cuenta creada:',
          rollbackError
        );
      }
    }


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );

  }finally{

    if(secondaryApp){

      try{

        await deleteApp(
          secondaryApp
        );

      }catch{}
    }


    setBusy(
      button,
      false
    );
  }
}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logoutAdmin(){

  try{

    await signOut(
      auth
    );

  }catch(error){

    console.error(
      'Error cerrando sesión:',
      error
    );


    toast(
      firebaseErrorMessage(
        error
      ),
      'error'
    );
  }
}


/* =========================================================
   EVENTOS
   ========================================================= */

function bindEvents(){

  $('adminLoginForm')
    ?.addEventListener(
      'submit',
      handleAdminLogin
    );


  $('adminLogoutBtn')
    ?.addEventListener(
      'click',
      logoutAdmin
    );


  $('adminDeniedLogoutBtn')
    ?.addEventListener(
      'click',
      logoutAdmin
    );


  $('adminRefreshBtn')
    ?.addEventListener(
      'click',
      loadAccounts
    );


  $('adminSearch')
    ?.addEventListener(
      'input',
      applyFilters
    );


  $('adminStatusFilter')
    ?.addEventListener(
      'change',
      applyFilters
    );


  $('adminCreateUserBtn')
    ?.addEventListener(
      'click',
      ()=>{
        $('adminCreateForm')
          .reset();

        openAdminModal(
          'adminCreateModal'
        );
      }
    );


  $('adminCreateForm')
    ?.addEventListener(
      'submit',
      createAccount
    );


  $('adminAccountList')
    ?.addEventListener(
      'click',
      event=>{

        const button=
          event.target.closest(
            '[data-manage-user]'
          );


        if(!button){
          return;
        }


        openManageAccount(
          button.dataset.manageUser
        );
      }
    );


  document
    .querySelectorAll(
      '[data-admin-close]'
    )
    .forEach(
      button=>{

        button.addEventListener(
          'click',
          ()=>{
            closeAdminModal(
              button.dataset.adminClose
            );
          }
        );
      }
    );


  document
    .querySelectorAll(
      '.admin-modal-backdrop'
    )
    .forEach(
      modal=>{

        modal.addEventListener(
          'click',
          event=>{

            if(
              event.target===modal&&
              modal.id!==
                'adminConfirmModal'
            ){
              closeAdminModal(
                modal.id
              );
            }
          }
        );
      }
    );


  $('adminConfirmCancel')
    ?.addEventListener(
      'click',
      ()=>{
        resolveConfirmation(
          false
        );
      }
    );


  $('adminConfirmOk')
    ?.addEventListener(
      'click',
      ()=>{
        resolveConfirmation(
          true
        );
      }
    );


  $('adminSuspendDayBtn')
    ?.addEventListener(
      'click',
      ()=>{
        suspendSelected(1);
      }
    );


  $('adminSuspendWeekBtn')
    ?.addEventListener(
      'click',
      ()=>{
        suspendSelected(7);
      }
    );


  $('adminApplyCustomBlockBtn')
    ?.addEventListener(
      'click',
      applyCustomSuspension
    );


  $('adminBlockForeverBtn')
    ?.addEventListener(
      'click',
      blockForever
    );


  $('adminReactivateBtn')
    ?.addEventListener(
      'click',
      reactivateAccount
    );


  $('adminSaveNoteBtn')
    ?.addEventListener(
      'click',
      saveAdminNote
    );


  document.addEventListener(
    'keydown',
    event=>{

      if(
        event.key!=='Escape'
      ){
        return;
      }


      if(
        $('adminConfirmModal')
          ?.classList
          .contains('show')
      ){

        resolveConfirmation(
          false
        );

        return;
      }


      const openModal=
        document.querySelector(
          '.admin-modal-backdrop.show'
        );


      if(openModal){

        closeAdminModal(
          openModal.id
        );
      }
    }
  );
}


/* =========================================================
   CONTROL DE SESIÓN
   ========================================================= */

async function handleAuthState(
  user
){

  if(!user){

    state.admin=null;

    state.accounts=[];

    state.filteredAccounts=[];

    state.selectedAccount=null;

    showLoginScreen();

    return;
  }


  try{

    const authorized=
      await isAuthorizedAdmin(
        user.uid
      );


    if(!authorized){

      state.admin=null;

      showDeniedScreen();

      return;
    }


    state.admin=
      user;


    await enterAdmin();

  }catch(error){

    console.error(
      'Error comprobando permisos administrativos:',
      error
    );


    state.admin=null;

    showDeniedScreen();
  }
}


/* =========================================================
   INICIALIZACIÓN
   ========================================================= */

async function initAdmin(){

  bindEvents();


  try{

    await firebaseReady;


    onAuthStateChanged(
      auth,
      user=>{

        handleAuthState(
          user
        ).catch(
          error=>{

            console.error(
              'Error procesando la sesión:',
              error
            );


            showDeniedScreen();
          }
        );
      }
    );

  }catch(error){

    console.error(
      'No se pudo inicializar Firebase:',
      error
    );


    hide(
      $('adminBoot')
    );


    showLoginScreen();


    setLoginMessage(
      'No se pudo iniciar Firebase. Recarga la página e intenta nuevamente.',
      'error'
    );
  }
}


initAdmin();