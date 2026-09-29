import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';

import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

import {
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  clearIndexedDbPersistence,
  terminate
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

import {
  firebaseConfig
} from './firebase-config.js';


/* =========================================================
   ALMACENAMIENTO LOCAL SEGURO
   ========================================================= */

const TRUSTED_DEVICE_KEY=
  'worklog_trusted_device';


function storageGet(
  key,
  fallback=null
){
  try{
    return localStorage.getItem(
      key
    )??fallback;

  }catch(error){
    console.warn(
      'WorkLog no pudo leer localStorage:',
      error
    );

    return fallback;
  }
}


function storageSet(
  key,
  value
){
  try{
    localStorage.setItem(
      key,
      value
    );

    return true;

  }catch(error){
    console.warn(
      'WorkLog no pudo guardar en localStorage:',
      error
    );

    return false;
  }
}


function storageRemove(
  key
){
  try{
    localStorage.removeItem(
      key
    );

  }catch(error){
    console.warn(
      'WorkLog no pudo limpiar localStorage:',
      error
    );
  }
}


/* =========================================================
   DISPOSITIVO DE CONFIANZA
   ========================================================= */

/*
  Por defecto WorkLog considera el
  dispositivo como de confianza.

  Solo deja de serlo cuando guardamos:
  worklog_trusted_device = false
*/

export function isTrustedDevice(){
  return storageGet(
    TRUSTED_DEVICE_KEY,
    'true'
  )!=='false';
}


const trusted=
  isTrustedDevice();


/* =========================================================
   FIREBASE APP
   ========================================================= */

export const firebaseApp=
  initializeApp(
    firebaseConfig
  );


/* =========================================================
   AUTHENTICATION
   ========================================================= */

export const auth=
  getAuth(
    firebaseApp
  );


/*
  Firebase intentará generar correos
  y mensajes compatibles en español.
*/

try{
  auth.languageCode=
    'es';
}catch{}


/* =========================================================
   FIRESTORE
   ========================================================= */

/*
  Dispositivo de confianza:
  IndexedDB persistente.

  Equipo compartido:
  solo memoria.

  Esto permite que en tu celular:
  - WorkLog abra más rápido.
  - Puedas trabajar temporalmente offline.
  - Los meses ya visitados estén disponibles
    sin descargarlos otra vez inmediatamente.
*/

function createLocalCache(){

  if(!trusted){
    return memoryLocalCache();
  }


  /*
    Si IndexedDB ni siquiera existe,
    usamos memoria para no impedir
    que WorkLog abra.
  */

  if(
    typeof indexedDB===
    'undefined'
  ){
    console.warn(
      'IndexedDB no está disponible. WorkLog usará caché en memoria.'
    );

    return memoryLocalCache();
  }


  return persistentLocalCache({
    tabManager:
      persistentMultipleTabManager()
  });
}


export const db=
  initializeFirestore(
    firebaseApp,
    {
      localCache:
        createLocalCache()
    }
  );


/* =========================================================
   PERSISTENCIA DE AUTH
   ========================================================= */

/*
  El usuario no debería perder la capacidad
  de iniciar sesión solamente porque el
  navegador rechazó la persistencia local.

  Por eso:

  1. Intentamos la persistencia elegida.
  2. Si falla, usamos sesión.
*/


async function initializeAuthPersistence(){

  const preferred=
    trusted
      ?browserLocalPersistence
      :browserSessionPersistence;


  try{

    await setPersistence(
      auth,
      preferred
    );

    return {
      ready:true,
      persistence:
        trusted
          ?'local'
          :'session',
      fallback:false
    };

  }catch(error){

    console.warn(
      'No se pudo aplicar la persistencia principal de Auth:',
      error
    );


    /*
      Si ya intentábamos sesión,
      no tiene sentido repetirla.
    */

    if(
      preferred===
      browserSessionPersistence
    ){
      return {
        ready:true,
        persistence:'default',
        fallback:true,
        error
      };
    }


    try{

      await setPersistence(
        auth,
        browserSessionPersistence
      );


      console.warn(
        'WorkLog continuará usando persistencia de sesión.'
      );


      return {
        ready:true,
        persistence:'session',
        fallback:true,
        error
      };

    }catch(fallbackError){

      console.warn(
        'Tampoco se pudo aplicar persistencia de sesión:',
        fallbackError
      );


      /*
        Firebase Auth todavía puede funcionar
        con la persistencia disponible por defecto.
      */

      return {
        ready:true,
        persistence:'default',
        fallback:true,
        error:fallbackError
      };
    }
  }
}


export const firebaseReady=
  initializeAuthPersistence();


/* =========================================================
   INFORMACIÓN DE PERSISTENCIA
   ========================================================= */

export function getPersistenceInfo(){

  return {
    trusted:
      isTrustedDevice(),

    firestore:
      trusted&&
      typeof indexedDB!==
        'undefined'
        ?'persistent'
        :'memory',

    auth:
      trusted
        ?'local'
        :'session'
  };
}


/* =========================================================
   PREFERENCIA DISPOSITIVO DE CONFIANZA
   ========================================================= */

/*
  IMPORTANTE:

  Esta función cambia la preferencia,
  pero Firestore necesita que la página
  sea recargada para inicializarse otra
  vez con el nuevo tipo de caché.

  Tu app.js ya hace location.reload()
  después de llamar esta función.
*/

export async function applyTrustedDevicePreference(
  value
){

  const trustedValue=
    Boolean(value);


  storageSet(
    TRUSTED_DEVICE_KEY,
    trustedValue
      ?'true'
      :'false'
  );


  /*
    Si vamos a un dispositivo NO confiable,
    borramos la copia persistente local.
  */

  if(!trustedValue){

    try{

      /*
        Firestore debe terminarse antes
        de borrar IndexedDB.
      */

      await terminate(db);

    }catch(error){

      console.warn(
        'No se pudo finalizar Firestore antes de limpiar la caché:',
        error
      );
    }


    try{

      await clearIndexedDbPersistence(
        db
      );

    }catch(error){

      /*
        No siempre significa un problema grave.

        Por ejemplo:
        - el navegador no tenía IndexedDB,
        - nunca existió una caché persistente,
        - otro contexto mantiene algo abierto.
      */

      console.warn(
        'No se pudo limpiar completamente la caché persistente de Firestore:',
        error
      );
    }


    /*
      Limpiamos preferencias locales de
      WorkLog que no deben permanecer en
      un equipo compartido.

      No borramos tema/acento porque no
      contienen información personal.
    */

    storageRemove(
      'worklog_pin_hash'
    );

    storageRemove(
      'worklog_pin_timeout'
    );


    try{
      sessionStorage.removeItem(
        'worklog_pin_unlocked'
      );

    }catch{}
  }


  return {
    trusted:
      trustedValue,

    reloadRequired:true
  };
}


/* =========================================================
   LIMPIAR CACHÉ MANUALMENTE
   ========================================================= */

/*
  Puede utilizarse más adelante desde
  Ajustes si queremos añadir:

  "Limpiar datos guardados en este dispositivo"

  Después de llamarla hay que recargar.
*/

export async function clearLocalFirestoreCache(){

  try{

    await terminate(db);

  }catch(error){

    console.warn(
      'No se pudo terminar Firestore:',
      error
    );
  }


  try{

    await clearIndexedDbPersistence(
      db
    );

    return true;

  }catch(error){

    console.warn(
      'No se pudo limpiar IndexedDB:',
      error
    );

    return false;
  }
}