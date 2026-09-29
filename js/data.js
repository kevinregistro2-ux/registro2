import {
  arrayUnion,
  arrayRemove,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  serverTimestamp,
  setDoc,
  writeBatch,
  FieldPath,
  waitForPendingWrites
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

import { db } from './firebase.js';

import {
  SCHEMA_VERSION,
  DEFAULT_TYPES,
  DEFAULT_CATEGORIES,
  DEFAULT_NOTES,
  CATEGORY_LABEL_TO_ID,
  PART_MAX_ACTIVITIES,
  PART_MAX_ESTIMATED_BYTES
} from './constants.js';


/* =========================================================
   SINCRONIZACIÓN
   ========================================================= */

let pendingWrites=0;
let lastSyncError=null;
let lastSyncedAt=null;

const syncListeners=new Set();

const isOnline=()=>
  typeof navigator==='undefined'||
  navigator.onLine!==false;


function syncSnapshot(){
  return {
    pending:pendingWrites,
    online:isOnline(),
    error:lastSyncError,
    lastSyncedAt
  };
}


function emitSync(){
  const snapshot=syncSnapshot();

  syncListeners.forEach(fn=>{
    try{
      fn(snapshot);
    }catch(error){
      console.warn(
        'WorkLog sync listener:',
        error
      );
    }
  });
}


export function subscribeSync(fn){
  if(typeof fn!=='function'){
    return ()=>{};
  }

  syncListeners.add(fn);

  try{
    fn(syncSnapshot());
  }catch{}

  return ()=>
    syncListeners.delete(fn);
}


export function getSyncSnapshot(){
  return syncSnapshot();
}


function trackWrite(
  promise,
  label='write'
){
  pendingWrites+=1;

  emitSync();

  promise
    .then(()=>{
      pendingWrites=
        Math.max(
          0,
          pendingWrites-1
        );

      lastSyncedAt=
        new Date();

      /*
        Si anteriormente hubo un error,
        no lo ocultamos simplemente porque
        otra escritura sí funcionó.
      */

      emitSync();
    })
    .catch(error=>{
      pendingWrites=
        Math.max(
          0,
          pendingWrites-1
        );

      lastSyncError={
        label,
        error
      };

      emitSync();
    });

  return promise;
}


function timeoutPromise(
  promise,
  ms,
  message
){
  let timer;

  const timeout=
    new Promise(
      (_,reject)=>{
        timer=
          setTimeout(
            ()=>{
              reject(
                new Error(
                  message
                )
              );
            },
            ms
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


if(typeof window!=='undefined'){

  window.addEventListener(
    'online',
    async()=>{
      emitSync();

      try{
        await timeoutPromise(
          waitForPendingWrites(db),
          15000,
          'Firebase sigue sincronizando. Intenta nuevamente en unos segundos.'
        );

        lastSyncedAt=
          new Date();

      }catch{}

      emitSync();
    }
  );


  window.addEventListener(
    'offline',
    emitSync
  );
}


export async function waitForSync(){
  if(!isOnline()){
    return false;
  }

  await timeoutPromise(
    waitForPendingWrites(db),
    15000,
    'La sincronización está tardando demasiado. Revisa tu conexión.'
  );

  lastSyncedAt=
    new Date();

  lastSyncError=
    null;

  emitSync();

  return true;
}


/* =========================================================
   REFERENCIAS
   ========================================================= */

const configRef=
  uid=>
    doc(
      db,
      'users',
      uid,
      'config',
      'main'
    );


const monthRef=
  (uid,month)=>
    doc(
      db,
      'users',
      uid,
      'months',
      month
    );


const partRef=
  (uid,month,part)=>
    doc(
      db,
      'users',
      uid,
      'months',
      month,
      'parts',
      part
    );


/* =========================================================
   UTILIDADES / VALIDACIÓN
   ========================================================= */

const MONTH_RE=
  /^\d{4}-(0[1-9]|1[0-2])$/;

const DATE_RE=
  /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;

const TIME_RE=
  /^([01]\d|2[0-3]):[0-5]\d$/;

const SAFE_ID_RE=
  /^[A-Za-z0-9_-]{1,120}$/;


function requireUid(uid){
  if(
    !uid||
    typeof uid!=='string'
  ){
    throw new Error(
      'Sesión no válida.'
    );
  }
}


function requireMonth(month){
  if(
    !MONTH_RE.test(
      String(month||'')
    )
  ){
    throw new Error(
      'El mes no es válido.'
    );
  }
}


function cleanText(
  value,
  max=250
){
  return String(
    value??''
  )
    .trim()
    .slice(
      0,
      max
    );
}


function cleanId(
  value,
  fallback=''
){
  const id=
    String(
      value??''
    ).trim();

  return SAFE_ID_RE.test(id)
    ?id
    :fallback;
}


function cleanTags(tags){
  if(!Array.isArray(tags)){
    return [];
  }

  return [
    ...new Set(
      tags
        .map(
          tag=>
            cleanText(
              tag,
              40
            )
        )
        .filter(Boolean)
    )
  ].slice(
    0,
    12
  );
}


function validDate(value){
  return DATE_RE.test(
    String(
      value||''
    )
  );
}


function validTime(value){
  return TIME_RE.test(
    String(
      value||''
    )
  );
}


function clone(obj){
  if(obj===undefined){
    return undefined;
  }

  if(
    typeof structuredClone===
    'function'
  ){
    try{
      return structuredClone(
        obj
      );
    }catch{}
  }

  return JSON.parse(
    JSON.stringify(
      obj
    )
  );
}


export function newId(
  prefix='id'
){
  const safePrefix=
    cleanText(
      prefix,
      12
    )
      .replace(
        /[^A-Za-z0-9_-]/g,
        ''
      )||
    'id';

  let random='';

  try{

    if(
      globalThis.crypto
        ?.randomUUID
    ){
      random=
        crypto
          .randomUUID()
          .replaceAll(
            '-',
            ''
          )
          .slice(
            0,
            14
          );

    }else if(
      globalThis.crypto
        ?.getRandomValues
    ){
      const bytes=
        new Uint8Array(10);

      crypto.getRandomValues(
        bytes
      );

      random=
        [...bytes]
          .map(
            value=>
              value
                .toString(16)
                .padStart(
                  2,
                  '0'
                )
          )
          .join('')
          .slice(
            0,
            14
          );
    }

  }catch{}


  if(!random){
    random=
      (
        Date.now()
          .toString(36)+
        Math.random()
          .toString(36)
          .slice(2)
      )
        .slice(
          0,
          14
        );
  }

  return `${safePrefix}_${random}`;
}


function legacyTypeCode(value){
  const direct={
    'Depósito':'DEP',
    'Deposito':'DEP',
    'Retiro':'RET',
    'Entrega de documentos':'DOC',
    'Pago':'PAG',
    'Cobro':'COB',
    'Compra':'COM',
    'Trámite':'TRA',
    'Tramite':'TRA',
    'Visita':'VIS',
    'Otro':'OTR'
  };

  const text=
    String(
      value||''
    );

  if(DEFAULT_TYPES[text]){
    return text;
  }

  return (
    direct[text]||
    text||
    'OTR'
  );
}


function normalizeStatus(value){
  if(
    [
      'D',
      'P',
      'C'
    ].includes(value)
  ){
    return value;
  }

  if(
    value==='pending'||
    value==='Pendiente'
  ){
    return 'P';
  }

  if(
    value==='cancelled'||
    value==='Cancelado'
  ){
    return 'C';
  }

  return 'D';
}


function normalizePriority(value){
  return [
    'L',
    'M',
    'H'
  ].includes(value)
    ?value
    :'M';
}


/* =========================================================
   CONFIGURACIÓN / MIGRACIÓN
   ========================================================= */

export function makeDefaultConfig(){
  return {
    sv:SCHEMA_VERSION,

    p:{},

    t:clone(
      DEFAULT_TYPES
    ),

    c:clone(
      DEFAULT_CATEGORIES
    ),

    q:{},

    n:[
      ...DEFAULT_NOTES
    ],

    m:[]
  };
}


function normalizeConfig(raw={}){
  const oldVersion=
    Number(
      raw?.sv||
      0
    );

  const config={
    sv:SCHEMA_VERSION,

    p:
      raw?.p&&
      typeof raw.p==='object'
        ?clone(raw.p)
        :{},

    t:
      raw?.t&&
      typeof raw.t==='object'
        ?clone(raw.t)
        :{},

    c:
      raw?.c&&
      typeof raw.c==='object'
        ?clone(raw.c)
        :{},

    q:
      raw?.q&&
      typeof raw.q==='object'
        ?clone(raw.q)
        :{},

    n:
      Array.isArray(raw?.n)
        ?raw.n
          .map(
            value=>
              cleanText(
                value,
                120
              )
          )
          .filter(Boolean)
        :[
          ...DEFAULT_NOTES
        ],

    m:
      Array.isArray(raw?.m)
        ?[
          ...new Set(
            raw.m.filter(
              month=>
                MONTH_RE.test(
                  String(month)
                )
            )
          )
        ]
        :[]
  };


  for(
    const [id,item]
    of Object.entries(
      DEFAULT_TYPES
    )
  ){
    if(!config.t[id]){
      config.t[id]=
        clone(item);
    }
  }


  for(
    const [id,item]
    of Object.entries(
      DEFAULT_CATEGORIES
    )
  ){
    if(!config.c[id]){
      config.c[id]=
        clone(item);
    }
  }


  for(
    const [id,place]
    of Object.entries(
      config.p
    )
  ){

    if(
      !place||
      typeof place!=='object'
    ){
      delete config.p[id];
      continue;
    }

    place.n=
      cleanText(
        place.n||
        place.name||
        'Lugar',
        120
      )||
      'Lugar';

    place.a=
      cleanText(
        place.a||
        place.address||
        '',
        240
      );

    place.r=
      cleanText(
        place.r||
        place.reference||
        '',
        160
      );

    place.f=
      Boolean(
        place.f??
        place.favorite
      );

    place.x=
      Boolean(
        place.x
      );

    if(
      CATEGORY_LABEL_TO_ID[
        place.c
      ]
    ){
      place.c=
        CATEGORY_LABEL_TO_ID[
          place.c
        ];
    }

    place.c=
      cleanId(
        place.c,
        'OTR'
      )||
      'OTR';
  }


  for(
    const [id,type]
    of Object.entries(
      config.t
    )
  ){

    if(
      !type||
      typeof type!=='object'
    ){
      delete config.t[id];
      continue;
    }

    type.n=
      cleanText(
        type.n||
        id,
        100
      )||
      id;

    type.i=
      cleanText(
        type.i||
        '•',
        8
      )||
      '•';

    type.f=
      Boolean(
        type.f
      );

    type.x=
      Boolean(
        type.x
      );
  }


  for(
    const [id,category]
    of Object.entries(
      config.c
    )
  ){

    if(
      !category||
      typeof category!=='object'
    ){
      delete config.c[id];
      continue;
    }

    category.n=
      cleanText(
        category.n||
        id,
        100
      )||
      id;

    category.i=
      cleanText(
        category.i||
        '•',
        8
      )||
      '•';

    category.x=
      Boolean(
        category.x
      );
  }


  for(
    const [id,template]
    of Object.entries(
      config.q
    )
  ){

    if(
      !template||
      typeof template!=='object'
    ){
      delete config.q[id];
      continue;
    }

    template.p=
      cleanId(
        template.p,
        ''
      );

    template.y=
      legacyTypeCode(
        template.y
      );

    template.n=
      cleanText(
        template.n||
        '',
        120
      );

    template.note=
      cleanText(
        template.note||
        '',
        500
      );

    template.o=
      Number.isFinite(
        Number(
          template.o
        )
      )
        ?Number(
          template.o
        )
        :0;

    template.x=
      Boolean(
        template.x
      );
  }


  config.n=[
    ...new Set(
      config.n
    )
  ].slice(
    0,
    50
  );


  config.m
    .sort()
    .reverse();


  return {
    config,

    needsMigration:
      oldVersion<
      SCHEMA_VERSION
  };
}


/* =========================================================
   ACTIVIDADES
   ========================================================= */

function normalizeActivity(
  raw={},
  oldVersion=SCHEMA_VERSION
){
  const rawValue=
    Number(
      raw?.v??
      raw?.value??
      0
    );


  const cents=
    oldVersion<5
      ?Math.round(
        rawValue*100
      )
      :Math.round(
        rawValue
      );


  return {

    d:
      validDate(
        raw?.d||
        raw?.date
      )
        ?String(
          raw.d||
          raw.date
        )
        :'',

    t:
      validTime(
        raw?.t||
        raw?.time
      )
        ?String(
          raw.t||
          raw.time
        )
        :'',

    p:
      cleanId(
        raw?.p||
        raw?.placeId,
        ''
      ),

    y:
      legacyTypeCode(
        raw?.y||
        raw?.typeCode||
        raw?.type||
        'OTR'
      ),

    v:
      Number.isSafeInteger(
        cents
      )&&
      cents>=0
        ?cents
        :0,

    s:
      normalizeStatus(
        raw?.s||
        raw?.status
      ),

    pr:
      normalizePriority(
        raw?.pr
      ),

    du:
      validDate(
        raw?.du
      )
        ?String(
          raw.du
        )
        :'',

    n:
      cleanText(
        raw?.n||
        raw?.note||
        '',
        800
      ),

    g:
      cleanTags(
        raw?.g
      ),

    z:
      Boolean(
        raw?.z
      ),

    zd:
      cleanText(
        raw?.zd||
        '',
        50
      )
  };
}


function compactActivity(
  activity
){

  if(
    !validDate(
      activity?.date
    )
  ){
    throw new Error(
      'La fecha de la actividad no es válida.'
    );
  }


  if(
    !validTime(
      activity?.time
    )
  ){
    throw new Error(
      'La hora de la actividad no es válida.'
    );
  }


  const placeId=
    cleanId(
      activity?.placeId,
      ''
    );


  const typeId=
    cleanId(
      activity?.typeId,
      ''
    );


  if(!placeId){
    throw new Error(
      'Selecciona un lugar válido.'
    );
  }


  if(!typeId){
    throw new Error(
      'Selecciona una actividad válida.'
    );
  }


  const value=
    Number(
      activity?.valueCents||
      0
    );


  if(
    !Number.isSafeInteger(
      value
    )||
    value<0
  ){
    throw new Error(
      'El valor de la actividad no es válido.'
    );
  }


  return normalizeActivity(
    {
      d:activity.date,
      t:activity.time,
      p:placeId,
      y:typeId,
      v:value,
      s:activity.status,
      pr:activity.priority,
      du:activity.dueDate,
      n:activity.note,
      g:activity.tags,
      z:activity.deleted,
      zd:activity.deletedAt
    },
    SCHEMA_VERSION
  );
}


/* =========================================================
   LECTURA CONFIG
   ========================================================= */

export async function loadConfigFromCache(
  uid
){
  requireUid(uid);

  try{

    const snap=
      await getDocFromCache(
        configRef(uid)
      );

    if(!snap.exists()){
      return null;
    }

    return normalizeConfig(
      snap.data()
    ).config;

  }catch{
    return null;
  }
}


export async function loadConfig(uid){
  requireUid(uid);

  const snap=
    await getDoc(
      configRef(uid)
    );


  if(!snap.exists()){

    const config=
      makeDefaultConfig();

    trackWrite(
      setDoc(
        configRef(uid),
        {
          ...config,
          u:serverTimestamp()
        }
      ),
      'create-config'
    );

    return config;
  }


  const {
    config,
    needsMigration
  }=
    normalizeConfig(
      snap.data()
    );


  if(needsMigration){

    trackWrite(
      setDoc(
        configRef(uid),
        {
          ...config,
          u:serverTimestamp()
        },
        {
          merge:true
        }
      ),
      'migrate-config'
    );
  }


  return config;
}


/* =========================================================
   MESES / SHARDS
   ========================================================= */

function emptyMonthState(){
  return {
    sv:SCHEMA_VERSION,
    mode:'single',
    parts:[],
    activities:{},
    partMap:{},
    exists:false,
    needsMigration:false
  };
}


function normalizeMonthMeta(
  raw={}
){
  const oldVersion=
    Number(
      raw?.sv||
      0
    );


  const mode=
    raw?.mode==='sharded'
      ?'sharded'
      :'single';


  const activities={};

  const partMap={};


  if(mode==='single'){

    const source=
      raw?.a&&
      typeof raw.a==='object'
        ?raw.a
        :{};


    for(
      const [id,activity]
      of Object.entries(
        source
      )
    ){
      activities[id]=
        normalizeActivity(
          activity,
          oldVersion
        );

      partMap[id]=
        '__single__';
    }
  }


  return {
    sv:SCHEMA_VERSION,

    mode,

    parts:
      Array.isArray(
        raw?.parts
      )
        ?[
          ...new Set(
            raw.parts.filter(
              part=>
                SAFE_ID_RE.test(
                  String(part)
                )
            )
          )
        ]
        :[],

    activities,

    partMap,

    needsMigration:
      oldVersion<
      SCHEMA_VERSION
  };
}


function monthPublic(state){
  return {
    sv:SCHEMA_VERSION,

    mode:
      state.mode,

    parts:[
      ...state.parts
    ],

    activities:
      state.activities,

    partMap:
      state.partMap,

    exists:
      Boolean(
        state.exists
      ),

    needsMigration:
      Boolean(
        state.needsMigration
      )
  };
}


async function mapWithConcurrency(
  items,
  limit,
  mapper
){
  const result=
    new Array(
      items.length
    );

  let cursor=0;


  async function worker(){

    while(true){

      const index=
        cursor++;

      if(
        index>=
        items.length
      ){
        return;
      }

      result[index]=
        await mapper(
          items[index],
          index
        );
    }
  }


  const workers=
    Array.from(
      {
        length:
          Math.min(
            limit,
            Math.max(
              1,
              items.length
            )
          )
      },
      ()=>worker()
    );


  await Promise.all(
    workers
  );

  return result;
}


async function readMonthWith(
  reader,
  uid,
  month
){
  requireUid(uid);
  requireMonth(month);


  let snap;


  try{

    snap=
      await reader(
        monthRef(
          uid,
          month
        )
      );

  }catch{
    return null;
  }


  if(!snap.exists()){
    return emptyMonthState();
  }


  const meta=
    normalizeMonthMeta(
      snap.data()
    );


  if(
    meta.mode==='sharded'&&
    meta.parts.length
  ){

    const snaps=
      await mapWithConcurrency(
        meta.parts,
        6,
        async part=>{

          try{

            return [
              part,

              await reader(
                partRef(
                  uid,
                  month,
                  part
                )
              )
            ];

          }catch{

            return [
              part,
              null
            ];
          }
        }
      );


    for(
      const [
        part,
        partSnap
      ]
      of snaps
    ){

      if(
        !partSnap?.exists()
      ){
        continue;
      }


      const raw=
        partSnap.data();


      const partVersion=
        Number(
          raw?.sv||
          SCHEMA_VERSION
        );


      const source=
        raw?.a&&
        typeof raw.a==='object'
          ?raw.a
          :{};


      for(
        const [id,activity]
        of Object.entries(
          source
        )
      ){

        meta.activities[id]=
          normalizeActivity(
            activity,
            partVersion
          );

        meta.partMap[id]=
          part;
      }
    }
  }


  meta.exists=true;

  return monthPublic(
    meta
  );
}


export async function loadMonthFromCache(
  uid,
  month
){
  return readMonthWith(
    getDocFromCache,
    uid,
    month
  );
}


export async function loadMonth(
  uid,
  month
){
  requireUid(uid);
  requireMonth(month);


  const state=
    await readMonthWith(
      getDoc,
      uid,
      month
    )||
    emptyMonthState();


  if(state.needsMigration){

    const batch=
      writeBatch(db);


    if(
      state.mode===
      'single'
    ){

      batch.set(
        monthRef(
          uid,
          month
        ),

        {
          sv:SCHEMA_VERSION,
          mode:'single',
          a:clone(
            state.activities
          ),
          parts:deleteField(),
          u:serverTimestamp()
        },

        {
          merge:true
        }
      );

    }else{

      for(
        const part
        of state.parts
      ){

        const subset={};


        for(
          const [id,activity]
          of Object.entries(
            state.activities
          )
        ){

          if(
            state.partMap[id]===
            part
          ){
            subset[id]=
              activity;
          }
        }


        batch.set(
          partRef(
            uid,
            month,
            part
          ),

          {
            sv:SCHEMA_VERSION,
            a:subset,
            u:serverTimestamp()
          },

          {
            merge:true
          }
        );
      }


      batch.set(
        monthRef(
          uid,
          month
        ),

        {
          sv:SCHEMA_VERSION,
          mode:'sharded',
          u:serverTimestamp()
        },

        {
          merge:true
        }
      );
    }


    state.needsMigration=
      false;


    trackWrite(
      batch.commit(),
      'migrate-month'
    );
  }


  return state;
}


/* =========================================================
   TAMAÑO DE DOCUMENTOS
   ========================================================= */

function activityBytes(map){
  const json=
    JSON.stringify(map);

  try{
    return new Blob(
      [json]
    ).size;
  }catch{}

  try{
    return new TextEncoder()
      .encode(
        json
      ).length;
  }catch{}

  return json.length;
}


function needsSharding(map){
  return (
    Object.keys(map).length>
      PART_MAX_ACTIVITIES||

    activityBytes(map)>
      PART_MAX_ESTIMATED_BYTES
  );
}


function splitActivities(map){
  const chunks=[];

  let current={};


  for(
    const [id,activity]
    of Object.entries(map)
  ){

    const candidate={
      ...current,
      [id]:activity
    };


    if(
      Object.keys(current).length>0&&
      (
        Object.keys(candidate).length>
          PART_MAX_ACTIVITIES||

        activityBytes(candidate)>
          PART_MAX_ESTIMATED_BYTES
      )
    ){

      chunks.push(
        current
      );

      current={
        [id]:activity
      };

    }else{

      current=
        candidate;
    }
  }


  if(
    Object.keys(current).length
  ){
    chunks.push(
      current
    );
  }


  return chunks;
}


function shardActivities(
  state,
  part,
  excludeId=''
){
  const result={};


  for(
    const [id,activity]
    of Object.entries(
      state.activities
    )
  ){

    if(
      id!==excludeId&&
      state.partMap[id]===
        part
    ){
      result[id]=
        activity;
    }
  }


  return result;
}


/* =========================================================
   ESCRITURA DE MESES
   ========================================================= */

function updateMonthIndexInBatch(
  batch,
  uid,
  config,
  month
){

  if(
    config.m.includes(
      month
    )
  ){
    return;
  }


  batch.set(
    configRef(uid),

    {
      m:arrayUnion(
        month
      ),
      sv:SCHEMA_VERSION,
      u:serverTimestamp()
    },

    {
      merge:true
    }
  );


  config.m.unshift(
    month
  );


  config.m=[
    ...new Set(
      config.m
    )
  ]
    .sort()
    .reverse();
}


function writeSingleActivity(
  batch,
  uid,
  month,
  state,
  id,
  compact
){

  batch.set(
    monthRef(
      uid,
      month
    ),

    {
      sv:SCHEMA_VERSION,
      mode:'single',

      a:{
        [id]:compact
      },

      u:serverTimestamp()
    },

    {
      mergeFields:[
        'sv',
        'mode',
        new FieldPath(
          'a',
          id
        ),
        'u'
      ]
    }
  );


  state.activities[id]=
    compact;

  state.partMap[id]=
    '__single__';

  state.exists=
    true;
}


function convertSingleToShards(
  batch,
  uid,
  month,
  state,
  newActivities
){

  const chunks=
    splitActivities(
      newActivities
    );


  if(
    chunks.length>430
  ){
    throw new Error(
      'Este mes es demasiado grande para convertirlo en una sola operación.'
    );
  }


  const partIds=[];

  const partMap={};


  chunks.forEach(
    (
      chunk,
      index
    )=>{

      const partId=
        `p${index+1}`;


      partIds.push(
        partId
      );


      for(
        const id
        of Object.keys(
          chunk
        )
      ){
        partMap[id]=
          partId;
      }


      batch.set(
        partRef(
          uid,
          month,
          partId
        ),

        {
          sv:SCHEMA_VERSION,
          a:chunk,
          u:serverTimestamp()
        }
      );
    }
  );


  batch.set(
    monthRef(
      uid,
      month
    ),

    {
      sv:SCHEMA_VERSION,
      mode:'sharded',
      parts:partIds,
      a:deleteField(),
      u:serverTimestamp()
    },

    {
      merge:true
    }
  );


  state.mode=
    'sharded';

  state.parts=
    partIds;

  state.activities=
    newActivities;

  state.partMap=
    partMap;

  state.exists=
    true;
}


function nextShardId(state){
  let index=1;

  const used=
    new Set(
      state.parts
    );


  while(
    used.has(
      `p${index}`
    )
  ){
    index++;
  }


  return `p${index}`;
}


function chooseShard(
  state,
  id,
  compact
){

  const currentPart=
    state.partMap[id];


  if(
    currentPart&&
    currentPart!=='__single__'
  ){

    const candidate={
      ...shardActivities(
        state,
        currentPart,
        id
      ),

      [id]:compact
    };


    if(
      !needsSharding(
        candidate
      )
    ){
      return {
        part:currentPart,
        isNew:false,
        moveFrom:null
      };
    }
  }


  const last=
    state.parts[
      state.parts.length-1
    ];


  if(
    last&&
    last!==currentPart
  ){

    const candidate={
      ...shardActivities(
        state,
        last
      ),

      [id]:compact
    };


    if(
      !needsSharding(
        candidate
      )
    ){
      return {
        part:last,
        isNew:false,
        moveFrom:
          currentPart||
          null
      };
    }
  }


  const next=
    nextShardId(
      state
    );


  state.parts.push(
    next
  );


  return {
    part:next,
    isNew:true,
    moveFrom:
      currentPart||
      null
  };
}


function writeShardedActivity(
  batch,
  uid,
  month,
  state,
  id,
  compact
){

  const target=
    chooseShard(
      state,
      id,
      compact
    );


  if(
    target.moveFrom&&
    target.moveFrom!==
      target.part
  ){

    batch.update(
      partRef(
        uid,
        month,
        target.moveFrom
      ),

      new FieldPath(
        'a',
        id
      ),

      deleteField(),

      'u',

      serverTimestamp()
    );
  }


  batch.set(
    partRef(
      uid,
      month,
      target.part
    ),

    {
      sv:SCHEMA_VERSION,

      a:{
        [id]:compact
      },

      u:serverTimestamp()
    },

    {
      mergeFields:[
        'sv',
        new FieldPath(
          'a',
          id
        ),
        'u'
      ]
    }
  );


  if(target.isNew){

    batch.set(
      monthRef(
        uid,
        month
      ),

      {
        sv:SCHEMA_VERSION,
        mode:'sharded',
        parts:arrayUnion(
          target.part
        ),
        u:serverTimestamp()
      },

      {
        merge:true
      }
    );
  }


  state.activities[id]=
    compact;

  state.partMap[id]=
    target.part;

  state.exists=
    true;
}


function removeActivityFromBatch(
  batch,
  uid,
  month,
  state,
  id
){

  const part=
    state.partMap[id];


  if(!part){
    return;
  }


  if(
    part==='__single__'
  ){

    batch.update(
      monthRef(
        uid,
        month
      ),

      new FieldPath(
        'a',
        id
      ),

      deleteField(),

      'u',

      serverTimestamp()
    );

  }else{

    const idsInPart=
      Object.keys(
        state.partMap
      )
        .filter(
          activityId=>
            state.partMap[
              activityId
            ]===part
        );


    if(
      idsInPart.length<=1
    ){

      batch.delete(
        partRef(
          uid,
          month,
          part
        )
      );


      batch.update(
        monthRef(
          uid,
          month
        ),

        'parts',

        arrayRemove(
          part
        ),

        'u',

        serverTimestamp()
      );


      state.parts=
        state.parts.filter(
          value=>
            value!==part
        );

    }else{

      batch.update(
        partRef(
          uid,
          month,
          part
        ),

        new FieldPath(
          'a',
          id
        ),

        deleteField(),

        'u',

        serverTimestamp()
      );
    }
  }


  delete state.activities[id];

  delete state.partMap[id];
}


/* =========================================================
   GUARDAR ACTIVIDAD
   ========================================================= */

export function queueSaveActivity(
  uid,
  config,
  state,
  month,
  activity,
  id=null
){
  requireUid(uid);
  requireMonth(month);


  const activityId=
    id||
    newId('a');


  const compact=
    compactActivity(
      activity
    );


  const batch=
    writeBatch(db);


  const predicted={
    ...state.activities,

    [activityId]:
      compact
  };


  if(
    state.mode==='single'&&
    needsSharding(
      predicted
    )
  ){

    convertSingleToShards(
      batch,
      uid,
      month,
      state,
      predicted
    );

  }else if(
    state.mode==='sharded'
  ){

    writeShardedActivity(
      batch,
      uid,
      month,
      state,
      activityId,
      compact
    );

  }else{

    writeSingleActivity(
      batch,
      uid,
      month,
      state,
      activityId,
      compact
    );
  }


  updateMonthIndexInBatch(
    batch,
    uid,
    config,
    month
  );


  const promise=
    trackWrite(
      batch.commit(),
      'save-activity'
    );


  return {
    id:activityId,
    promise
  };
}


/* =========================================================
   MOVER ACTIVIDAD ENTRE MESES
   ========================================================= */

export function queueMoveActivity(
  uid,
  config,
  sourceState,
  sourceMonth,
  targetState,
  targetMonth,
  id,
  activity
){
  requireUid(uid);

  requireMonth(
    sourceMonth
  );

  requireMonth(
    targetMonth
  );


  if(
    sourceMonth===
    targetMonth
  ){
    return queueSaveActivity(
      uid,
      config,
      targetState,
      targetMonth,
      activity,
      id
    );
  }


  if(
    !sourceState
      .activities[id]
  ){
    throw new Error(
      'Actividad no encontrada.'
    );
  }


  const compact=
    compactActivity(
      activity
    );


  const batch=
    writeBatch(db);


  /*
    Eliminación + creación ocurren
    dentro del mismo batch.
  */

  removeActivityFromBatch(
    batch,
    uid,
    sourceMonth,
    sourceState,
    id
  );


  const predicted={
    ...targetState.activities,

    [id]:
      compact
  };


  if(
    targetState.mode==='single'&&
    needsSharding(
      predicted
    )
  ){

    convertSingleToShards(
      batch,
      uid,
      targetMonth,
      targetState,
      predicted
    );

  }else if(
    targetState.mode===
    'sharded'
  ){

    writeShardedActivity(
      batch,
      uid,
      targetMonth,
      targetState,
      id,
      compact
    );

  }else{

    writeSingleActivity(
      batch,
      uid,
      targetMonth,
      targetState,
      id,
      compact
    );
  }


  updateMonthIndexInBatch(
    batch,
    uid,
    config,
    targetMonth
  );


  const promise=
    trackWrite(
      batch.commit(),
      'move-activity'
    );


  return {
    id,
    promise
  };
}


/* =========================================================
   MODIFICACIONES PEQUEÑAS DE ACTIVIDAD
   ========================================================= */

function patchActivity(
  uid,
  month,
  state,
  id,
  changes,
  label
){
  requireUid(uid);

  requireMonth(
    month
  );


  const current=
    state.activities[id];


  if(!current){
    throw new Error(
      'Actividad no encontrada.'
    );
  }


  const next=
    normalizeActivity(
      {
        ...current,
        ...changes
      },
      SCHEMA_VERSION
    );


  const part=
    state.partMap[id];


  if(!part){
    throw new Error(
      'No se pudo localizar la actividad en el mes.'
    );
  }


  const reference=
    part==='__single__'
      ?monthRef(
        uid,
        month
      )
      :partRef(
        uid,
        month,
        part
      );


  const batch=
    writeBatch(db);


  batch.set(
    reference,

    {
      a:{
        [id]:next
      },

      u:serverTimestamp()
    },

    {
      mergeFields:[
        new FieldPath(
          'a',
          id
        ),

        'u'
      ]
    }
  );


  state.activities[id]=
    next;


  return trackWrite(
    batch.commit(),
    label
  );
}


export function queueTrashActivity(
  uid,
  month,
  state,
  id
){
  return patchActivity(
    uid,
    month,
    state,
    id,

    {
      z:true,
      zd:
        new Date()
          .toISOString()
    },

    'trash-activity'
  );
}


export function queueRestoreActivity(
  uid,
  month,
  state,
  id
){
  return patchActivity(
    uid,
    month,
    state,
    id,

    {
      z:false,
      zd:''
    },

    'restore-activity'
  );
}


export function queueCompleteActivity(
  uid,
  month,
  state,
  id
){
  return patchActivity(
    uid,
    month,
    state,
    id,

    {
      s:'D'
    },

    'complete-activity'
  );
}


export function queuePurgeActivity(
  uid,
  month,
  state,
  id
){
  requireUid(uid);

  requireMonth(
    month
  );


  if(
    !state.activities[id]
  ){
    throw new Error(
      'Actividad no encontrada.'
    );
  }


  const batch=
    writeBatch(db);


  removeActivityFromBatch(
    batch,
    uid,
    month,
    state,
    id
  );


  return trackWrite(
    batch.commit(),
    'purge-activity'
  );
}


/* =========================================================
   ESCRITURAS PARCIALES DE CONFIG
   ========================================================= */

function writeConfigMapItem(
  uid,
  bucket,
  id,
  item,
  label,
  {
    includeVersion=false
  }={}
){
  requireUid(uid);


  const data={
    [bucket]:{
      [id]:
        clone(item)
    },

    u:serverTimestamp()
  };


  const mergeFields=[
    new FieldPath(
      bucket,
      id
    ),

    'u'
  ];


  if(includeVersion){
    data.sv=
      SCHEMA_VERSION;

    mergeFields.push(
      'sv'
    );
  }


  return trackWrite(
    setDoc(
      configRef(uid),
      data,
      {
        mergeFields
      }
    ),
    label
  );
}


/* =========================================================
   LUGARES
   ========================================================= */

export function queueSavePlace(
  uid,
  config,
  data,
  id=null
){
  const placeId=
    id||
    newId('p');


  const old=
    config.p[
      placeId
    ]||
    {};


  const name=
    cleanText(
      data?.name,
      120
    );


  if(!name){
    throw new Error(
      'Escribe el nombre del lugar.'
    );
  }


  const categoryId=
    cleanId(
      data?.categoryId,
      'OTR'
    )||
    'OTR';


  const compact={
    n:name,

    a:
      cleanText(
        data?.address,
        240
      ),

    c:
      categoryId,

    r:
      cleanText(
        data?.reference,
        160
      ),

    f:
      Boolean(
        data?.favorite??
        old.f
      ),

    x:
      Boolean(
        data?.archived??
        old.x
      )
  };


  config.p[
    placeId
  ]=
    compact;


  return {
    id:placeId,

    promise:
      writeConfigMapItem(
        uid,
        'p',
        placeId,
        compact,
        'save-place',
        {
          includeVersion:true
        }
      )
  };
}


export function queueArchivePlace(
  uid,
  config,
  id,
  archived=true
){
  if(!config.p[id]){
    throw new Error(
      'Lugar no encontrado.'
    );
  }


  config.p[id].x=
    Boolean(
      archived
    );


  return writeConfigMapItem(
    uid,
    'p',
    id,
    config.p[id],

    archived
      ?'archive-place'
      :'restore-place'
  );
}


export function queueFavoritePlace(
  uid,
  config,
  id,
  favorite
){
  if(!config.p[id]){
    throw new Error(
      'Lugar no encontrado.'
    );
  }


  config.p[id].f=
    Boolean(
      favorite
    );


  return writeConfigMapItem(
    uid,
    'p',
    id,
    config.p[id],
    'favorite-place'
  );
}


/* =========================================================
   TIPOS DE ACTIVIDAD
   ========================================================= */

export function queueSaveType(
  uid,
  config,
  data,
  id=null
){
  const typeId=
    id||
    newId('t');


  const old=
    config.t[
      typeId
    ]||
    {};


  const name=
    cleanText(
      data?.name,
      100
    );


  if(!name){
    throw new Error(
      'Escribe el nombre de la actividad.'
    );
  }


  const compact={
    n:name,

    i:
      cleanText(
        data?.icon||
        '•',
        8
      )||
      '•',

    f:
      Boolean(
        data?.favorite??
        old.f
      ),

    x:
      Boolean(
        data?.archived??
        old.x
      )
  };


  config.t[
    typeId
  ]=
    compact;


  return {
    id:typeId,

    promise:
      writeConfigMapItem(
        uid,
        't',
        typeId,
        compact,
        'save-type',
        {
          includeVersion:true
        }
      )
  };
}


export function queueArchiveType(
  uid,
  config,
  id,
  archived=true
){
  if(!config.t[id]){
    throw new Error(
      'Actividad no encontrada.'
    );
  }


  config.t[id].x=
    Boolean(
      archived
    );


  return writeConfigMapItem(
    uid,
    't',
    id,
    config.t[id],

    archived
      ?'archive-type'
      :'restore-type'
  );
}


export function queueFavoriteType(
  uid,
  config,
  id,
  favorite
){
  if(!config.t[id]){
    throw new Error(
      'Actividad no encontrada.'
    );
  }


  config.t[id].f=
    Boolean(
      favorite
    );


  return writeConfigMapItem(
    uid,
    't',
    id,
    config.t[id],
    'favorite-type'
  );
}


/* =========================================================
   CATEGORÍAS
   ========================================================= */

export function queueSaveCategory(
  uid,
  config,
  data,
  id=null
){
  const categoryId=
    id||
    newId('c');


  const old=
    config.c[
      categoryId
    ]||
    {};


  const name=
    cleanText(
      data?.name,
      100
    );


  if(!name){
    throw new Error(
      'Escribe el nombre de la categoría.'
    );
  }


  const compact={
    n:name,

    i:
      cleanText(
        data?.icon||
        '•',
        8
      )||
      '•',

    x:
      Boolean(
        data?.archived??
        old.x
      )
  };


  config.c[
    categoryId
  ]=
    compact;


  return {
    id:categoryId,

    promise:
      writeConfigMapItem(
        uid,
        'c',
        categoryId,
        compact,
        'save-category',
        {
          includeVersion:true
        }
      )
  };
}


export function queueArchiveCategory(
  uid,
  config,
  id,
  archived=true
){
  if(!config.c[id]){
    throw new Error(
      'Categoría no encontrada.'
    );
  }


  config.c[id].x=
    Boolean(
      archived
    );


  return writeConfigMapItem(
    uid,
    'c',
    id,
    config.c[id],

    archived
      ?'archive-category'
      :'restore-category'
  );
}


/* =========================================================
   PLANTILLAS
   ========================================================= */

export function queueSaveTemplate(
  uid,
  config,
  data,
  id=null
){
  const templateId=
    id||
    newId('q');


  const old=
    config.q[
      templateId
    ]||
    {};


  const placeId=
    cleanId(
      data?.placeId,
      ''
    );


  const typeId=
    cleanId(
      data?.typeId,
      ''
    );


  if(
    !placeId||
    !config.p[
      placeId
    ]
  ){
    throw new Error(
      'Selecciona un lugar válido para la plantilla.'
    );
  }


  if(
    !typeId||
    !config.t[
      typeId
    ]
  ){
    throw new Error(
      'Selecciona una actividad válida para la plantilla.'
    );
  }


  const order=
    Number(
      data?.order??
      old.o??
      Object.keys(
        config.q
      ).length
    );


  const compact={
    p:placeId,

    y:typeId,

    n:
      cleanText(
        data?.name,
        120
      ),

    note:
      cleanText(
        data?.note,
        500
      ),

    o:
      Number.isFinite(
        order
      )
        ?order
        :0,

    x:
      Boolean(
        data?.archived??
        old.x
      )
  };


  config.q[
    templateId
  ]=
    compact;


  return {
    id:templateId,

    promise:
      writeConfigMapItem(
        uid,
        'q',
        templateId,
        compact,
        'save-template'
      )
  };
}


export function queueArchiveTemplate(
  uid,
  config,
  id,
  archived=true
){
  if(!config.q[id]){
    throw new Error(
      'Plantilla no encontrada.'
    );
  }


  config.q[id].x=
    Boolean(
      archived
    );


  return writeConfigMapItem(
    uid,
    'q',
    id,
    config.q[id],

    archived
      ?'archive-template'
      :'restore-template'
  );
}


export function queueReorderTemplates(
  uid,
  config,
  orderedIds
){
  requireUid(uid);


  const changed={};

  const mergeFields=[];


  orderedIds.forEach(
    (
      id,
      index
    )=>{

      if(
        !config.q[id]
      ){
        return;
      }


      config.q[id].o=
        index;


      changed[id]=
        clone(
          config.q[id]
        );


      mergeFields.push(
        new FieldPath(
          'q',
          id
        )
      );
    }
  );


  if(
    !mergeFields.length
  ){
    return Promise.resolve();
  }


  const data={
    q:changed,
    u:serverTimestamp()
  };


  mergeFields.push(
    'u'
  );


  return trackWrite(
    setDoc(
      configRef(uid),
      data,
      {
        mergeFields
      }
    ),
    'reorder-templates'
  );
}


/* =========================================================
   NOTAS RÁPIDAS
   ========================================================= */

export function queueSaveNotes(
  uid,
  config,
  notes
){
  requireUid(uid);


  config.n=[
    ...new Set(
      (
        Array.isArray(notes)
          ?notes
          :[]
      )
        .map(
          value=>
            cleanText(
              value,
              120
            )
        )
        .filter(Boolean)
    )
  ].slice(
    0,
    50
  );


  return trackWrite(
    setDoc(
      configRef(uid),

      {
        n:config.n,
        u:serverTimestamp()
      },

      {
        mergeFields:[
          'n',
          'u'
        ]
      }
    ),
    'save-notes'
  );
}


/* =========================================================
   CARGAR TODOS LOS MESES
   ========================================================= */

export async function loadAllMonths(
  uid,
  config,
  onProgress=()=>{}
){
  requireUid(uid);


  const months=[
    ...new Set(
      config.m.filter(
        month=>
          MONTH_RE.test(
            String(month)
          )
      )
    )
  ].sort();


  const result={};

  let completed=0;


  await mapWithConcurrency(
    months,
    3,

    async month=>{

      result[month]=
        await loadMonth(
          uid,
          month
        );


      completed++;


      try{
        onProgress(
          completed,
          months.length
        );
      }catch{}
    }
  );


  return result;
}


/* =========================================================
   BACKUP
   ========================================================= */

export function makeBackup(
  config,
  months
){
  const cleanConfig={
    sv:SCHEMA_VERSION,

    p:
      clone(
        config.p
      ),

    t:
      clone(
        config.t
      ),

    c:
      clone(
        config.c
      ),

    q:
      clone(
        config.q
      ),

    n:[
      ...config.n
    ],

    m:[
      ...config.m
    ]
  };


  const cleanMonths={};


  for(
    const [month,state]
    of Object.entries(
      months
    )
  ){

    if(
      !MONTH_RE.test(
        month
      )
    ){
      continue;
    }


    cleanMonths[month]={
      sv:SCHEMA_VERSION,

      activities:
        clone(
          state.activities||
          {}
        )
    };
  }


  return {
    format:
      'worklog-backup',

    version:2,

    schemaVersion:
      SCHEMA_VERSION,

    createdAt:
      new Date()
        .toISOString(),

    config:
      cleanConfig,

    months:
      cleanMonths
  };
}


/* =========================================================
   VALIDAR BACKUP
   ========================================================= */

export function validateBackup(
  data
){

  if(
    !data||
    typeof data!=='object'
  ){
    throw new Error(
      'La copia no es válida.'
    );
  }


  if(
    data.format!==
      'worklog-backup'||

    !data.config||

    !data.months
  ){
    throw new Error(
      'El archivo no parece ser una copia válida de WorkLog.'
    );
  }


  if(
    typeof data.config.p!==
      'object'||

    Array.isArray(
      data.config.p
    )||

    typeof data.months!==
      'object'||

    Array.isArray(
      data.months
    )
  ){
    throw new Error(
      'La estructura de la copia no es válida.'
    );
  }


  const monthEntries=
    Object.entries(
      data.months
    );


  if(
    monthEntries.length>
    240
  ){
    throw new Error(
      'La copia contiene demasiados meses.'
    );
  }


  let totalActivities=0;


  for(
    const [month,raw]
    of monthEntries
  ){

    if(
      !MONTH_RE.test(
        month
      )
    ){
      throw new Error(
        `La copia contiene un mes inválido: ${month}`
      );
    }


    if(
      !raw||
      typeof raw!=='object'||
      typeof raw.activities!=='object'||
      Array.isArray(
        raw.activities
      )
    ){
      throw new Error(
        `La estructura del mes ${month} no es válida.`
      );
    }


    totalActivities+=
      Object.keys(
        raw.activities
      ).length;


    if(
      totalActivities>
      100000
    ){
      throw new Error(
        'La copia contiene demasiadas actividades para importarla de una vez.'
      );
    }
  }


  return true;
}


/* =========================================================
   LIMPIAR PARTES ANTIGUAS
   ========================================================= */

async function deleteKnownParts(
  uid,
  month
){
  const snap=
    await getDoc(
      monthRef(
        uid,
        month
      )
    );


  if(!snap.exists()){
    return;
  }


  const raw=
    snap.data();


  const parts=
    Array.isArray(
      raw?.parts
    )
      ?raw.parts.filter(
        part=>
          SAFE_ID_RE.test(
            String(part)
          )
      )
      :[];


  if(!parts.length){
    return;
  }


  let batch=
    writeBatch(db);

  let operations=0;


  for(
    const part
    of parts
  ){

    batch.delete(
      partRef(
        uid,
        month,
        part
      )
    );


    operations++;


    if(
      operations>=400
    ){
      await batch.commit();

      batch=
        writeBatch(db);

      operations=0;
    }
  }


  if(operations){
    await batch.commit();
  }
}


/* =========================================================
   ESCRIBIR MES COMPLETO
   ========================================================= */

async function writeFullMonth(
  uid,
  month,
  state
){
  requireUid(uid);

  requireMonth(
    month
  );


  await deleteKnownParts(
    uid,
    month
  );


  const activities=
    state.activities||
    {};


  if(
    !needsSharding(
      activities
    )
  ){

    return trackWrite(
      setDoc(
        monthRef(
          uid,
          month
        ),

        {
          sv:SCHEMA_VERSION,
          mode:'single',
          a:activities,
          parts:deleteField(),
          u:serverTimestamp()
        },

        {
          merge:true
        }
      ),
      'import-month'
    );
  }


  const chunks=
    splitActivities(
      activities
    );


  const parts=
    chunks.map(
      (_,index)=>
        `p${index+1}`
    );


  await trackWrite(
    setDoc(
      monthRef(
        uid,
        month
      ),

      {
        sv:SCHEMA_VERSION,
        mode:'sharded',
        parts,
        a:deleteField(),
        u:serverTimestamp()
      },

      {
        merge:true
      }
    ),
    'import-month-meta'
  );


  let batch=
    writeBatch(db);

  let operations=0;


  for(
    let index=0;
    index<chunks.length;
    index++
  ){

    batch.set(
      partRef(
        uid,
        month,
        parts[index]
      ),

      {
        sv:SCHEMA_VERSION,
        a:chunks[index],
        u:serverTimestamp()
      }
    );


    operations++;


    if(
      operations>=350
    ){

      await trackWrite(
        batch.commit(),
        'import-month-parts'
      );


      batch=
        writeBatch(db);


      operations=0;
    }
  }


  if(operations){

    await trackWrite(
      batch.commit(),
      'import-month-parts'
    );
  }
}


/* =========================================================
   IMPORTAR BACKUP
   ========================================================= */

export async function importBackup(
  uid,
  data
){
  requireUid(uid);

  validateBackup(
    data
  );


  const {
    config
  }=
    normalizeConfig(
      data.config
    );


  const months={};


  const sourceVersion=
    Number(
      data.schemaVersion||
      data.config?.sv||
      SCHEMA_VERSION
    );


  for(
    const [month,raw]
    of Object.entries(
      data.months
    )
  ){

    const activities={};


    for(
      const [id,activity]
      of Object.entries(
        raw.activities||
        {}
      )
    ){

      if(
        !SAFE_ID_RE.test(
          String(id)
        )
      ){
        continue;
      }


      activities[id]=
        normalizeActivity(
          activity,
          sourceVersion
        );
    }


    months[month]={
      sv:SCHEMA_VERSION,
      mode:'single',
      parts:[],
      activities,
      partMap:{},
      exists:true,
      needsMigration:false
    };


    config.m.push(
      month
    );
  }


  config.m=[
    ...new Set(
      config.m
    )
  ]
    .sort()
    .reverse();


  await trackWrite(
    setDoc(
      configRef(uid),

      {
        ...config,
        u:serverTimestamp()
      },

      {
        merge:true
      }
    ),
    'import-config'
  );


  for(
    const [month,state]
    of Object.entries(
      months
    )
  ){

    await writeFullMonth(
      uid,
      month,
      state
    );


    if(
      needsSharding(
        state.activities
      )
    ){

      const chunks=
        splitActivities(
          state.activities
        );


      state.mode=
        'sharded';


      state.parts=
        chunks.map(
          (_,index)=>
            `p${index+1}`
        );


      state.partMap={};


      chunks.forEach(
        (
          chunk,
          index
        )=>{

          for(
            const id
            of Object.keys(
              chunk
            )
          ){
            state.partMap[id]=
              state.parts[
                index
              ];
          }
        }
      );

    }else{

      state.mode=
        'single';


      state.parts=[];


      state.partMap={};


      for(
        const id
        of Object.keys(
          state.activities
        )
      ){
        state.partMap[id]=
          '__single__';
      }
    }
  }


  return {
    config,
    months
  };
}


/* =========================================================
   ELIMINAR TODOS LOS DATOS DEL USUARIO
   ========================================================= */

export async function deleteAllUserData(
  uid,
  config
){
  requireUid(uid);


  let batch=
    writeBatch(db);


  let operations=0;


  const flush=
    async()=>{

      if(!operations){
        return;
      }


      await batch.commit();


      batch=
        writeBatch(db);


      operations=0;
    };


  const months=[
    ...new Set(
      (
        config?.m||
        []
      )
        .filter(
          month=>
            MONTH_RE.test(
              String(month)
            )
        )
    )
  ];


  for(
    const month
    of months
  ){

    const snap=
      await getDoc(
        monthRef(
          uid,
          month
        )
      );


    if(!snap.exists()){
      continue;
    }


    const raw=
      snap.data();


    const parts=
      Array.isArray(
        raw?.parts
      )
        ?raw.parts
        :[];


    for(
      const part
      of parts
    ){

      if(
        !SAFE_ID_RE.test(
          String(part)
        )
      ){
        continue;
      }


      batch.delete(
        partRef(
          uid,
          month,
          part
        )
      );


      operations++;


      if(
        operations>=400
      ){
        await flush();
      }
    }


    batch.delete(
      monthRef(
        uid,
        month
      )
    );


    operations++;


    if(
      operations>=400
    ){
      await flush();
    }
  }


  batch.delete(
    configRef(uid)
  );


  operations++;


  await flush();
}