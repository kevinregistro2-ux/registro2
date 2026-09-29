import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
  deleteUser,
  reload
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';

import {
  auth,
  firebaseReady
} from './firebase.js';


/* =========================================================
   CONFIGURACIÓN
   ========================================================= */

const AUTH_TIMEOUT=20000;

let verificationSending=false;


/* =========================================================
   UTILIDADES
   ========================================================= */

function normalizeEmail(email){
  return String(
    email??''
  )
    .trim()
    .toLowerCase();
}


function validateEmail(email){
  const value=
    normalizeEmail(email);

  if(!value){
    throw new Error(
      'Escribe tu correo electrónico.'
    );
  }

  /*
    Firebase hará la validación definitiva,
    pero evitamos enviar valores claramente
    incorrectos.
  */

  if(
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
      value
    )
  ){
    const error=
      new Error(
        'El correo no es válido.'
      );

    error.code=
      'auth/invalid-email';

    throw error;
  }

  return value;
}


function validatePassword(
  password,
  {
    minimum=6,
    name='contraseña'
  }={}
){
  if(
    typeof password!==
    'string'
  ){
    throw new Error(
      `La ${name} no es válida.`
    );
  }

  if(
    password.length<
    minimum
  ){
    const error=
      new Error(
        `La ${name} debe tener al menos ${minimum} caracteres.`
      );

    error.code=
      'auth/weak-password';

    throw error;
  }

  return password;
}


function withTimeout(
  promise,
  message=
    'Firebase está tardando demasiado. Revisa tu conexión.'
){
  let timer=null;

  const timeout=
    new Promise(
      (_,reject)=>{
        timer=
          setTimeout(
            ()=>{
              const error=
                new Error(
                  message
                );

              error.code=
                'auth/network-timeout';

              reject(error);
            },
            AUTH_TIMEOUT
          );
      }
    );

  return Promise
    .race([
      promise,
      timeout
    ])
    .finally(
      ()=>{
        clearTimeout(timer);
      }
    );
}


async function ensureFirebase(){
  await withTimeout(
    firebaseReady,
    'No se pudo iniciar Firebase. Revisa tu conexión.'
  );

  /*
    Los correos generados por Firebase
    intentarán mostrarse en español.
  */

  try{
    auth.languageCode=
      'es';
  }catch{}

  return auth;
}


/* =========================================================
   ESCUCHAR SESIÓN
   ========================================================= */

export async function watchAuth(
  callback
){
  await ensureFirebase();

  if(
    typeof callback!==
    'function'
  ){
    throw new Error(
      'El observador de autenticación no es válido.'
    );
  }

  return onAuthStateChanged(
    auth,
    callback,
    error=>{
      console.error(
        'Firebase Auth:',
        error
      );
    }
  );
}


/* =========================================================
   REGISTRO
   ========================================================= */

export async function registerUser(
  email,
  password
){
  await ensureFirebase();

  const safeEmail=
    validateEmail(email);

  validatePassword(
    password
  );

  const result=
    await withTimeout(
      createUserWithEmailAndPassword(
        auth,
        safeEmail,
        password
      ),
      'La creación de la cuenta está tardando demasiado.'
    );

  let verificationSent=false;

  /*
    La cuenta ya existe aunque el envío
    del correo de verificación falle.
    Por eso no cancelamos el registro.
  */

  try{
    await sendEmailVerification(
      result.user
    );

    verificationSent=true;

  }catch(error){
    console.warn(
      'No se pudo enviar el correo de verificación:',
      error
    );
  }

  return {
    ...result,
    verificationSent
  };
}


/* =========================================================
   LOGIN
   ========================================================= */

export async function loginUser(
  email,
  password
){
  await ensureFirebase();

  const safeEmail=
    validateEmail(email);

  if(
    typeof password!==
      'string'||
    !password.length
  ){
    const error=
      new Error(
        'Escribe tu contraseña.'
      );

    error.code=
      'auth/missing-password';

    throw error;
  }

  return withTimeout(
    signInWithEmailAndPassword(
      auth,
      safeEmail,
      password
    ),
    'El inicio de sesión está tardando demasiado.'
  );
}


/* =========================================================
   CERRAR SESIÓN
   ========================================================= */

export async function logoutUser(){
  await ensureFirebase();

  if(!auth.currentUser){
    return;
  }

  return withTimeout(
    signOut(auth),
    'No se pudo cerrar la sesión en este momento.'
  );
}


/* =========================================================
   RESTABLECER CONTRASEÑA
   ========================================================= */

export async function resetPassword(
  email
){
  await ensureFirebase();

  const safeEmail=
    validateEmail(email);

  return withTimeout(
    sendPasswordResetEmail(
      auth,
      safeEmail
    ),
    'No se pudo enviar el correo de recuperación.'
  );
}


/* =========================================================
   VERIFICACIÓN DE CORREO
   ========================================================= */

export async function sendVerification(){
  await ensureFirebase();

  const user=
    auth.currentUser;

  if(!user){
    throw new Error(
      'No hay una sesión activa.'
    );
  }

  if(user.emailVerified){
    return {
      alreadyVerified:true
    };
  }

  /*
    Evita varios clics seguidos sobre
    "Enviar verificación".
  */

  if(verificationSending){
    throw new Error(
      'El correo de verificación ya se está enviando.'
    );
  }

  verificationSending=true;

  try{
    await withTimeout(
      sendEmailVerification(
        user
      ),
      'No se pudo enviar el correo de verificación.'
    );

    return {
      sent:true
    };

  }finally{
    verificationSending=false;
  }
}


/* =========================================================
   ACTUALIZAR USUARIO ACTUAL
   ========================================================= */

export async function refreshCurrentUser(){
  await ensureFirebase();

  const user=
    auth.currentUser;

  if(!user){
    return null;
  }

  await withTimeout(
    reload(user),
    'No se pudo actualizar la información de la cuenta.'
  );

  return auth.currentUser;
}


/* =========================================================
   REAUTENTICACIÓN
   ========================================================= */

export async function reauthenticate(
  password
){
  await ensureFirebase();

  const user=
    auth.currentUser;

  if(
    !user||
    !user.email
  ){
    throw new Error(
      'No hay una sesión válida.'
    );
  }

  if(
    typeof password!==
      'string'||
    !password.length
  ){
    throw new Error(
      'Escribe tu contraseña actual.'
    );
  }

  const credential=
    EmailAuthProvider
      .credential(
        user.email,
        password
      );

  await withTimeout(
    reauthenticateWithCredential(
      user,
      credential
    ),
    'No se pudo confirmar tu identidad.'
  );

  return user;
}


/* =========================================================
   CAMBIAR CONTRASEÑA
   ========================================================= */

export async function changePassword(
  currentPassword,
  newPassword
){
  validatePassword(
    newPassword,
    {
      minimum:6,
      name:'nueva contraseña'
    }
  );

  if(
    currentPassword===
    newPassword
  ){
    throw new Error(
      'La nueva contraseña debe ser diferente de la actual.'
    );
  }

  const user=
    await reauthenticate(
      currentPassword
    );

  await withTimeout(
    updatePassword(
      user,
      newPassword
    ),
    'No se pudo cambiar la contraseña.'
  );

  return true;
}


/* =========================================================
   ELIMINAR USUARIO
   ========================================================= */

export async function deleteCurrentUser(
  currentPassword
){
  const user=
    await reauthenticate(
      currentPassword
    );

  await withTimeout(
    deleteUser(user),
    'No se pudo eliminar la cuenta.'
  );

  return true;
}


/*
  Esta función se utiliza cuando la
  reautenticación ya se hizo antes.
*/

export async function deleteCurrentUserNow(){
  await ensureFirebase();

  const user=
    auth.currentUser;

  if(!user){
    throw new Error(
      'No hay una sesión activa.'
    );
  }

  await withTimeout(
    deleteUser(user),
    'No se pudo eliminar la cuenta.'
  );

  return true;
}


/* =========================================================
   USUARIO ACTUAL
   ========================================================= */

export function currentUser(){
  return auth.currentUser;
}


/* =========================================================
   ERRORES FIREBASE EN ESPAÑOL
   ========================================================= */

export function authErrorMessage(
  error
){
  const code=
    error?.code||
    '';

  const messages={

    'auth/invalid-credential':
      'Correo o contraseña incorrectos.',

    'auth/invalid-login-credentials':
      'Correo o contraseña incorrectos.',

    'auth/user-not-found':
      'No existe una cuenta con ese correo.',

    'auth/wrong-password':
      'Contraseña incorrecta.',

    'auth/missing-password':
      'Escribe tu contraseña.',

    'auth/email-already-in-use':
      'Ese correo ya tiene una cuenta.',

    'auth/credential-already-in-use':
      'Estas credenciales ya pertenecen a otra cuenta.',

    'auth/invalid-email':
      'El correo no es válido.',

    'auth/weak-password':
      'Usa una contraseña de al menos 6 caracteres.',

    'auth/password-does-not-meet-requirements':
      'La contraseña no cumple con los requisitos de seguridad.',

    'auth/too-many-requests':
      'Se realizaron demasiados intentos. Intenta nuevamente más tarde.',

    'auth/network-request-failed':
      'No se pudo conectar con Firebase. Revisa tu conexión a Internet.',

    'auth/network-timeout':
      'Firebase está tardando demasiado en responder. Revisa tu conexión.',

    'auth/requires-recent-login':
      'Por seguridad, vuelve a confirmar tu contraseña.',

    'auth/user-disabled':
      'Esta cuenta está deshabilitada.',

    'auth/operation-not-allowed':
      'Este método de inicio de sesión no está habilitado en Firebase.',

    'auth/invalid-api-key':
      'La configuración de Firebase no es válida.',

    'auth/app-not-authorized':
      'Esta aplicación no está autorizada para usar Firebase Authentication.',

    'auth/unauthorized-domain':
      'Este dominio no está autorizado en Firebase Authentication.',

    'auth/user-token-expired':
      'Tu sesión expiró. Vuelve a iniciar sesión.',

    'auth/invalid-user-token':
      'Tu sesión ya no es válida. Vuelve a iniciar sesión.',

    'auth/session-cookie-expired':
      'Tu sesión expiró. Vuelve a iniciar sesión.',

    'auth/internal-error':
      'Firebase tuvo un error interno. Intenta nuevamente.',

    'auth/quota-exceeded':
      'Se alcanzó temporalmente un límite de Firebase. Intenta más tarde.',

    'auth/expired-action-code':
      'Este enlace ya expiró.',

    'auth/invalid-action-code':
      'Este enlace ya no es válido.',

    'auth/account-exists-with-different-credential':
      'Ya existe una cuenta con ese correo usando otro método de acceso.'
  };


  if(
    code&&
    messages[code]
  ){
    return messages[code];
  }


  const message=
    String(
      error?.message||
      ''
    ).trim();


  /*
    Los errores creados por nosotros ya
    vienen escritos de forma comprensible.
  */

  if(
    message&&
    !message.startsWith(
      'Firebase:'
    )
  ){
    return message;
  }


  return 'Ocurrió un error inesperado. Intenta nuevamente.';
}