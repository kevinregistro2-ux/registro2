# WorkLog Premium V2

Aplicación web personal para registrar actividades, lugares frecuentes, pendientes, recorridos diarios e historial. El proyecto ya está conectado al proyecto Firebase **registro-kevin** mediante la configuración Web que ya se probó en la versión anterior.

## Estructura

```text
WorkLog_Premium_V2_Ready/
├── index.html
├── manifest.webmanifest
├── service-worker.js
├── firebase.json
├── README.md
├── DEPLOY.md
├── QA_CHECKLIST.md
├── css/
│   └── styles.css
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── constants.js
│   ├── data.js
│   ├── firebase-config.js
│   ├── firebase.js
│   └── ui.js
└── firebase/
    └── firestore.rules
```

## Mejoras principales implementadas

- Interfaz local-first: el registro aparece en pantalla antes de esperar la confirmación remota.
- Persistencia offline de Firestore basada en IndexedDB cuando el dispositivo es de confianza.
- Sin `onSnapshot()` permanentes.
- Escrituras agrupadas con `writeBatch()` cuando una operación afecta varios documentos.
- Migración automática de la estructura anterior al esquema V5 al cargar datos antiguos.
- Valores monetarios almacenados como centavos enteros.
- Actividades y categorías completamente personalizables.
- Actividades y lugares archivables/restaurables sin romper el historial antiguo.
- Lugares favoritos, tipos favoritos y sugerencia del tipo habitual por lugar.
- Plantillas rápidas Lugar + Actividad + Nota.
- Orden de plantillas con botones y arrastre en el panel rápido.
- Notas rápidas reutilizables.
- Prioridad, etiquetas y fecha límite para pendientes.
- Jornada diaria con paradas, pendientes y cierre del día.
- Repetir actividad y repetir última actividad.
- Papelera temporal y acción Deshacer.
- Búsqueda sin distinguir mayúsculas ni acentos.
- Filtros por fecha, mes, lugar, actividad, estado, prioridad y valor.
- Calendario con intensidad según cantidad de registros.
- Reportes locales: días activos, lugar más visitado, actividad frecuente, racha, hora frecuente, estados y comparación con mes anterior.
- Modo claro, oscuro o automático.
- Cuatro colores de acento y densidad cómoda/compacta.
- Barra real de estado: Guardado / Sincronizando / Sin conexión / Error.
- Sincronización manual y actualización al volver a la pestaña tras varios minutos.
- PWA instalable con manifest, iconos y service worker.
- CSV, copia JSON completa, restauración JSON e importación CSV.
- PIN local opcional y bloqueo tras tiempo fuera de la app.
- Verificación de correo, cambio de contraseña y eliminación de cuenta.
- Reglas Firestore más estrictas y limitadas a las rutas que usa WorkLog.
- Fragmentación adaptativa de meses grandes: normalmente 1 documento por mes y solo se divide cuando crece mucho.
- Capa de errores y reintento en lugar de quedarse cargando indefinidamente.
- Navegación inferior especial para móviles.

## Datos en Firestore

Configuración principal:

```text
users/{uid}/config/main
```

Mes normal:

```text
users/{uid}/months/2026-09
```

Si un mes crece demasiado, WorkLog lo convierte automáticamente a:

```text
users/{uid}/months/2026-09
users/{uid}/months/2026-09/parts/p1
users/{uid}/months/2026-09/parts/p2
```

No se usa Firebase Storage, Cloud Functions, Analytics ni Cloud Messaging.

## Importante antes de usar V2

La configuración Firebase ya está incluida en `js/firebase-config.js`, pero debes publicar las reglas nuevas de `firebase/firestore.rules` en Firebase Console > Firestore Database > Reglas.

La versión V2 reconoce la estructura compacta de la versión anterior. Los meses antiguos se convierten de forma perezosa al esquema V5 cuando se abren. En ese proceso, los valores monetarios anteriores se convierten a centavos enteros.

## Abrir localmente

Desde la carpeta del proyecto:

```powershell
npx live-server . --host=localhost --port=5500
```

No abras `index.html` con doble clic si quieres usar correctamente módulos, service worker, Authentication y PWA.

## Nota sobre el PIN local

El PIN local es una capa de privacidad de interfaz para un dispositivo compartido; no sustituye la contraseña de Firebase ni cifra la base de datos. Se guarda únicamente un hash SHA-256 del PIN en el navegador.

## Reportes y lecturas

Los reportes mensuales usan el mes ya cargado y no crean documentos de estadísticas. El botón **Analizar año** es intencionalmente bajo demanda: solo cuando lo pulsas WorkLog carga los meses de ese año que aparecen en el índice del usuario.

## Revisión final

El archivo `QA_CHECKLIST.md` contiene una lista de pruebas funcionales, offline, seguridad, PWA, importación/exportación y migración para validar cada área de la aplicación.
