/* =========================================================
   WORKLOG SERVICE WORKER
   ========================================================= */

/*
  r3 invalida la caché anterior.

  Esta revisión añade:
  - access.js al App Shell.
  - exclusión total del panel /admin.
  - administración únicamente online.
*/

const CACHE_NAME='worklog-v2-2.0.0-r3';


/* =========================================================
   ARCHIVOS PRINCIPALES DE LA APP
   ========================================================= */

const APP_SHELL=[
  '/',
  '/index.html',

  '/css/styles.css',

  '/js/app.js',
  '/js/access.js',
  '/js/auth.js',
  '/js/constants.js',
  '/js/data.js',
  '/js/firebase-config.js',
  '/js/firebase.js',
  '/js/ui.js',

  '/manifest.webmanifest',

  '/icons/icon-192.png',
  '/icons/icon-512.png'
];


/* =========================================================
   UTILIDADES
   ========================================================= */

function isHttpRequest(request){
  return (
    request.url.startsWith('http://')||
    request.url.startsWith('https://')
  );
}


function isSameOrigin(url){
  return (
    url.origin===
    self.location.origin
  );
}


function isFirebaseSdk(url){
  return (
    url.hostname==='www.gstatic.com'&&
    url.pathname.includes('/firebasejs/')
  );
}


/*
  El panel administrativo nunca debe funcionar
  desde una copia HTML almacenada por este
  Service Worker.
*/

function isAdminNavigation(url){
  return (
    url.pathname==='/admin'||
    url.pathname==='/admin/'||
    url.pathname==='/admin.html'||
    url.pathname.startsWith('/admin/')
  );
}


/*
  admin.js tampoco se guarda en la caché
  de WorkLog.

  Así el panel administrativo utiliza siempre
  la versión servida actualmente por Firebase
  Hosting.
*/

function isAdminStatic(url){
  return (
    url.pathname==='/js/admin.js'
  );
}


function isStaticAsset(url){
  return (
    url.pathname.endsWith('.css')||
    url.pathname.endsWith('.js')||
    url.pathname.endsWith('.webmanifest')
  );
}


function isImage(url){
  return (
    url.pathname.endsWith('.png')||
    url.pathname.endsWith('.jpg')||
    url.pathname.endsWith('.jpeg')||
    url.pathname.endsWith('.webp')||
    url.pathname.endsWith('.svg')||
    url.pathname.endsWith('.ico')
  );
}


async function safeCachePut(
  cache,
  request,
  response
){
  if(
    !response||
    !response.ok
  ){
    return;
  }

  try{
    await cache.put(
      request,
      response.clone()
    );

  }catch(error){
    console.warn(
      '[WorkLog SW] No se pudo guardar en caché:',
      request.url,
      error
    );
  }
}


/* =========================================================
   INSTALACIÓN
   ========================================================= */

self.addEventListener(
  'install',
  event=>{

    event.waitUntil(
      (
        async()=>{

          const cache=
            await caches.open(
              CACHE_NAME
            );


          /*
            Guardamos archivo por archivo.

            Así, si uno falla temporalmente,
            no impedimos que todo el Service
            Worker se instale.
          */

          await Promise.allSettled(
            APP_SHELL.map(
              async path=>{

                try{

                  const request=
                    new Request(
                      path,
                      {
                        cache:'reload'
                      }
                    );


                  const response=
                    await fetch(
                      request
                    );


                  if(response.ok){
                    await cache.put(
                      path,
                      response
                    );
                  }

                }catch(error){

                  console.warn(
                    '[WorkLog SW] No se pudo precargar:',
                    path,
                    error
                  );
                }
              }
            )
          );


          /*
            La nueva versión pasa a espera
            mínima inmediatamente.
          */

          await self.skipWaiting();
        }
      )()
    );
  }
);


/* =========================================================
   ACTIVACIÓN
   ========================================================= */

self.addEventListener(
  'activate',
  event=>{

    event.waitUntil(
      (
        async()=>{

          const cacheNames=
            await caches.keys();


          /*
            Eliminamos versiones anteriores
            de las cachés de WorkLog.
          */

          await Promise.all(
            cacheNames
              .filter(
                name=>
                  name.startsWith(
                    'worklog-'
                  )&&
                  name!==CACHE_NAME
              )
              .map(
                name=>
                  caches.delete(
                    name
                  )
              )
          );


          /*
            La versión nueva toma control
            de las pestañas abiertas.
          */

          await self.clients.claim();
        }
      )()
    );
  }
);


/* =========================================================
   PANEL ADMINISTRATIVO
   SOLO RED
   ========================================================= */

async function handleAdminRequest(
  request
){
  try{

    /*
      Pedimos siempre una respuesta de red.

      No utilizamos caches.match().
      No utilizamos index.html como fallback.
      No guardamos la respuesta.
    */

    return await fetch(
      request,
      {
        cache:'no-store'
      }
    );

  }catch(error){

    /*
      El panel administrativo es deliberadamente
      online-only.

      Si no existe conexión mostramos una página
      pequeña y segura, en lugar de abrir WorkLog
      desde su caché.
    */

    return new Response(
      `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta
    name="viewport"
    content="width=device-width,initial-scale=1"
  >
  <meta
    name="robots"
    content="noindex,nofollow,noarchive"
  >
  <title>WorkLog Admin · Sin conexión</title>

  <style>
    *{
      box-sizing:border-box;
    }

    html,
    body{
      margin:0;
      min-height:100%;
    }

    body{
      min-height:100vh;
      display:grid;
      place-items:center;
      padding:24px;
      font-family:
        Inter,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;
      background:#0b0d12;
      color:#f5f7fb;
    }

    main{
      width:min(100%,520px);
      padding:28px;
      border:1px solid rgba(255,255,255,.10);
      border-radius:22px;
      background:#141821;
      box-shadow:
        0 22px 60px rgba(0,0,0,.35);
    }

    h1{
      margin:0 0 12px;
      font-size:24px;
    }

    p{
      margin:0;
      color:#aeb7c7;
      line-height:1.6;
    }

    button{
      width:100%;
      margin-top:22px;
      padding:13px 16px;
      border:0;
      border-radius:12px;
      font:inherit;
      font-weight:700;
      cursor:pointer;
    }
  </style>
</head>

<body>
  <main>
    <h1>Panel administrativo sin conexión</h1>

    <p>
      El panel de administración de WorkLog necesita
      conexión a Internet para consultar y modificar
      el estado real de las cuentas.
    </p>

    <button onclick="location.reload()">
      Volver a intentar
    </button>
  </main>
</body>
</html>`,
      {
        status:503,
        statusText:'Service Unavailable',
        headers:{
          'Content-Type':'text/html; charset=utf-8',
          'Cache-Control':'no-store'
        }
      }
    );
  }
}


/* =========================================================
   NAVEGACIÓN PRINCIPAL
   NETWORK FIRST
   ========================================================= */

async function handleNavigation(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );


  try{

    /*
      Para páginas HTML normales siempre
      intentamos primero Internet.

      /admin nunca llega a esta función.
    */

    const response=
      await fetch(
        request
      );


    if(response.ok){

      /*
        La aplicación pública utiliza index.html
        como respaldo offline.

        Como /admin fue excluido anteriormente,
        nunca podremos sobrescribir index.html
        con admin.html.
      */

      await safeCachePut(
        cache,
        '/index.html',
        response
      );
    }


    return response;

  }catch(error){

    /*
      Sin Internet:
      usamos index.html guardado.
    */

    const fallback=
      await cache.match(
        '/index.html'
      );


    if(fallback){
      return fallback;
    }


    /*
      Último intento por compatibilidad.
    */

    const root=
      await cache.match(
        '/'
      );


    if(root){
      return root;
    }


    throw error;
  }
}


/* =========================================================
   CSS / JS / MANIFEST
   NETWORK FIRST
   ========================================================= */

async function handleFreshStatic(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );


  try{

    const response=
      await fetch(
        request
      );


    if(response.ok){

      await safeCachePut(
        cache,
        request,
        response
      );
    }


    return response;

  }catch(error){

    const cached=
      await cache.match(
        request
      );


    if(cached){
      return cached;
    }


    throw error;
  }
}


/* =========================================================
   IMÁGENES
   CACHE FIRST
   ========================================================= */

async function handleImage(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );


  const cached=
    await cache.match(
      request
    );


  if(cached){
    return cached;
  }


  const response=
    await fetch(
      request
    );


  if(response.ok){

    await safeCachePut(
      cache,
      request,
      response
    );
  }


  return response;
}


/* =========================================================
   FIREBASE SDK
   CACHE FIRST
   ========================================================= */

async function handleFirebaseSdk(
  request
){
  const cache=
    await caches.open(
      CACHE_NAME
    );


  /*
    Las URLs del SDK llevan versión:

    /firebasejs/12.19.0/...

    Por eso se pueden reutilizar de caché
    de forma segura.
  */

  const cached=
    await cache.match(
      request
    );


  if(cached){
    return cached;
  }


  const response=
    await fetch(
      request
    );


  if(response.ok){

    await safeCachePut(
      cache,
      request,
      response
    );
  }


  return response;
}


/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener(
  'fetch',
  event=>{

    const request=
      event.request;


    /*
      Solo solicitudes GET.
    */

    if(
      request.method!=='GET'
    ){
      return;
    }


    /*
      Ignoramos esquemas que no sean HTTP/HTTPS.
    */

    if(
      !isHttpRequest(
        request
      )
    ){
      return;
    }


    const url=
      new URL(
        request.url
      );


    /* -----------------------------------------------------
       PANEL ADMINISTRATIVO
       ----------------------------------------------------- */

    /*
      Este bloque DEBE estar antes de las
      navegaciones generales y antes de los
      archivos JS/CSS.

      De esa forma /admin y admin.js nunca
      llegan a las estrategias de caché
      normales.
    */

    if(
      isSameOrigin(url)&&
      (
        isAdminNavigation(url)||
        isAdminStatic(url)
      )
    ){

      event.respondWith(
        handleAdminRequest(
          request
        )
      );

      return;
    }


    /* -----------------------------------------------------
       NAVEGACIONES HTML DE WORKLOG
       ----------------------------------------------------- */

    if(
      request.mode==='navigate'&&
      isSameOrigin(url)
    ){

      event.respondWith(
        handleNavigation(
          request
        )
      );

      return;
    }


    /* -----------------------------------------------------
       ARCHIVOS PROPIOS JS / CSS / MANIFEST
       ----------------------------------------------------- */

    if(
      isSameOrigin(url)&&
      isStaticAsset(url)
    ){

      event.respondWith(
        handleFreshStatic(
          request
        )
      );

      return;
    }


    /* -----------------------------------------------------
       IMÁGENES E ICONOS PROPIOS
       ----------------------------------------------------- */

    if(
      isSameOrigin(url)&&
      isImage(url)
    ){

      event.respondWith(
        handleImage(
          request
        )
      );

      return;
    }


    /* -----------------------------------------------------
       OTROS ARCHIVOS PROPIOS
       ----------------------------------------------------- */

    if(
      isSameOrigin(url)
    ){

      event.respondWith(
        handleFreshStatic(
          request
        )
      );

      return;
    }


    /* -----------------------------------------------------
       SDK FIREBASE DESDE GSTATIC
       ----------------------------------------------------- */

    if(
      isFirebaseSdk(url)
    ){

      event.respondWith(
        handleFirebaseSdk(
          request
        )
      );

      return;
    }


    /*
      IMPORTANTE:

      No interceptamos ni almacenamos:

      - Firestore API
      - Firebase Auth API
      - llamadas de autenticación
      - documentos del usuario
      - tráfico hacia googleapis.com

      La persistencia offline de Firestore
      ya la administra Firebase mediante
      IndexedDB.
    */
  }
);


/* =========================================================
   MENSAJES
   ========================================================= */

/*
  app.js puede pedirle al Service Worker
  que active una actualización inmediatamente.
*/

self.addEventListener(
  'message',
  event=>{

    if(
      event.data?.type===
      'SKIP_WAITING'
    ){
      self.skipWaiting();
    }
  }
);