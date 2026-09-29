# Puesta en marcha

## 1. Publicar las reglas V2

1. Abre Firebase Console.
2. Entra en el proyecto `Registro kevin`.
3. Firestore Database > Reglas.
4. Abre `firebase/firestore.rules` de este proyecto.
5. Copia todo el contenido.
6. Sustituye las reglas actuales y pulsa **Publicar**.

No uses reglas públicas del tipo `allow read, write: if true`.

## 2. Authentication

Ya debe estar activo:

- Authentication
- Sign-in method
- Email/Password

`localhost`, `registro-kevin.firebaseapp.com` y `registro-kevin.web.app` ya estaban autorizados durante la configuración inicial.

## 3. Probar en VS Code

```powershell
cd "RUTA\WorkLog_Premium_V2_Ready"
npx live-server . --host=localhost --port=5500
```

Abre:

```text
http://localhost:5500
```

## 4. Prueba recomendada

1. Inicia sesión con tu cuenta existente.
2. Comprueba que los lugares antiguos aparecen.
3. Registra una actividad pequeña.
4. Observa que aparece de inmediato y arriba cambia a `Sincronizando` y luego a `Guardado`.
5. Crea un tipo de actividad personalizado en Ajustes.
6. Crea una plantilla rápida.
7. Cambia a modo claro y vuelve a oscuro.
8. Abre Firestore > Datos y confirma que el documento del mes se actualiza.
9. Prueba desconectar Internet, guardar una actividad y volver a conectarlo.

## 5. Publicar como PWA con Firebase Hosting (opcional)

Si quieres instalarla en Android/Windows desde una URL real, Firebase Hosting es una opción estática adecuada.

Con Node.js instalado:

```powershell
npm install -g firebase-tools
firebase login
firebase use registro-kevin
firebase deploy --only hosting
```

El archivo `firebase.json` ya está preparado.

Si `firebase use registro-kevin` no encuentra el proyecto, ejecuta:

```powershell
firebase projects:list
```

y selecciona el ID correcto.

## 6. Actualizaciones futuras

Cuando cambies HTML/CSS/JS y publiques una versión nueva, incrementa el nombre `CACHE` de `service-worker.js` para forzar la renovación del shell PWA.
