/* =========================================================
   WORKLOG
   CONSTANTES GENERALES
   ========================================================= */

export const APP_NAME='WorkLog';

export const APP_VERSION='2.0.0';

export const SCHEMA_VERSION=5;

export const FIREBASE_SDK_VERSION='12.19.0';


/* =========================================================
   LÍMITES DE ALMACENAMIENTO
   ========================================================= */

/*
  Cuando un mes supera alguno de estos límites,
  data.js comienza a dividirlo en partes.

  Los valores quedan bastante por debajo del
  límite máximo de un documento de Firestore.
*/

export const PART_MAX_ACTIVITIES=240;

export const PART_MAX_ESTIMATED_BYTES=550000;


/* =========================================================
   LÍMITES DE DATOS
   ========================================================= */

export const MAX_ACTIVITY_TAGS=12;

export const MAX_QUICK_NOTES=50;

export const MAX_PLACE_NAME_LENGTH=120;

export const MAX_PLACE_ADDRESS_LENGTH=240;

export const MAX_PLACE_REFERENCE_LENGTH=160;

export const MAX_ACTIVITY_NOTE_LENGTH=800;

export const MAX_TEMPLATE_NOTE_LENGTH=500;


/* =========================================================
   INTERFAZ
   ========================================================= */

export const MOBILE_BREAKPOINT=850;


/* =========================================================
   TIPOS DE ACTIVIDAD PREDETERMINADOS
   ========================================================= */

/*
  IMPORTANTE:

  Los códigos DEP, RET, DOC, etc. son IDs internos.
  No deben cambiarse porque pueden existir actividades
  antiguas guardadas con estos códigos.
*/

export const DEFAULT_TYPES={

  DEP:{
    n:'Depósito',
    i:'↓',
    f:true,
    x:false
  },

  RET:{
    n:'Retiro',
    i:'↑',
    f:true,
    x:false
  },

  DOC:{
    n:'Entrega de documentos',
    i:'▣',
    f:true,
    x:false
  },

  PAG:{
    n:'Pago',
    i:'$',
    f:false,
    x:false
  },

  COB:{
    n:'Cobro',
    i:'$',
    f:false,
    x:false
  },

  COM:{
    n:'Compra',
    i:'◇',
    f:false,
    x:false
  },

  TRA:{
    n:'Trámite',
    i:'◇',
    f:false,
    x:false
  },

  VIS:{
    n:'Visita',
    i:'⌖',
    f:false,
    x:false
  },

  OTR:{
    n:'Otro',
    i:'•',
    f:false,
    x:false
  }
};


/* =========================================================
   CATEGORÍAS PREDETERMINADAS
   ========================================================= */

export const DEFAULT_CATEGORIES={

  BAN:{
    n:'Banco',
    i:'🏦',
    x:false
  },

  CLI:{
    n:'Cliente',
    i:'⌖',
    x:false
  },

  TRA:{
    n:'Trámite',
    i:'▣',
    x:false
  },

  COM:{
    n:'Compra',
    i:'◇',
    x:false
  },

  TRB:{
    n:'Trabajo',
    i:'★',
    x:false
  },

  OTR:{
    n:'Otro',
    i:'•',
    x:false
  }
};


/* =========================================================
   MIGRACIÓN DE CATEGORÍAS ANTIGUAS
   ========================================================= */

export const CATEGORY_LABEL_TO_ID={

  'Banco':'BAN',
  'banco':'BAN',

  'Cliente':'CLI',
  'cliente':'CLI',

  'Trámite':'TRA',
  'Tramite':'TRA',
  'trámite':'TRA',
  'tramite':'TRA',

  'Compra':'COM',
  'compra':'COM',

  'Trabajo':'TRB',
  'trabajo':'TRB',

  'Otro':'OTR',
  'otro':'OTR'
};


/* =========================================================
   ESTADOS
   ========================================================= */

export const STATUSES={

  D:'Realizado',

  P:'Pendiente',

  C:'Cancelado'
};


/* =========================================================
   PRIORIDADES
   ========================================================= */

export const PRIORITIES={

  L:'Baja',

  M:'Media',

  H:'Alta'
};


/* =========================================================
   NOTAS RÁPIDAS PREDETERMINADAS
   ========================================================= */

export const DEFAULT_NOTES=[

  'Entregado y recibido',

  'Pendiente de firma',

  'Volver mañana'

];