# QA / Checklist de WorkLog Premium V2

Esta lista sirve para comprobar la versión final antes de reemplazar una versión anterior.

## 1. Inicio de sesión y cuenta

- [ ] Crear una cuenta nueva con correo y contraseña.
- [ ] Iniciar sesión con una cuenta existente.
- [ ] Contraseña incorrecta muestra un mensaje y no bloquea la interfaz.
- [ ] Recuperar contraseña envía el correo correspondiente.
- [ ] Enviar verificación de correo funciona.
- [ ] Cambiar contraseña exige volver a confirmar la contraseña actual.
- [ ] Cerrar sesión vuelve al login.
- [ ] Cambiar “Confiar en este dispositivo” recarga antes de iniciar sesión y aplica el tipo de caché correcto.
- [ ] Eliminar cuenta exige contraseña y confirmación fuerte.

## 2. Migración de la versión anterior

- [ ] Al iniciar con una cuenta existente aparecen los lugares anteriores.
- [ ] Los meses antiguos se abren sin perder actividades.
- [ ] Los valores antiguos en dólares se convierten a centavos internamente y se muestran igual visualmente.
- [ ] Las categorías antiguas se relacionan con las categorías V2.
- [ ] Los tipos antiguos DEP/RET/DOC/PAG/COB/COM/TRA/VIS/OTR conservan su nombre.

## 3. Guardado y sincronización

- [ ] Al guardar una actividad aparece inmediatamente en la interfaz.
- [ ] El estado superior cambia a “Sincronizando” y luego “Guardado”.
- [ ] Pulsar varias veces Guardar no genera duplicados mientras el botón está ocupado.
- [ ] Una actividad igual en la misma hora/lugar/tipo muestra aviso de posible duplicado.
- [ ] Editar dentro del mismo mes conserva el mismo registro.
- [ ] Cambiar una actividad a otro mes se realiza de forma atómica.
- [ ] Desconectar Internet permite trabajar con datos ya cacheados.
- [ ] Una escritura offline queda pendiente y se confirma al recuperar Internet.
- [ ] “Sincronizar ahora” actualiza configuración y mes actual.
- [ ] Volver a la pestaña tras varios minutos actualiza los datos sin listener permanente.
- [ ] Cerrar la página con escrituras pendientes muestra la advertencia del navegador.

## 4. Actividades y categorías personalizables

- [ ] Crear tipo de actividad.
- [ ] Editar tipo.
- [ ] Marcar tipo favorito.
- [ ] Archivar tipo sin romper el historial antiguo.
- [ ] Restaurar tipo archivado.
- [ ] Crear categoría de lugar.
- [ ] Editar categoría.
- [ ] Archivar/restaurar categoría.
- [ ] Un tipo o categoría personalizados aparecen en los selectores correspondientes.

## 5. Lugares

- [ ] Crear lugar.
- [ ] Editar lugar.
- [ ] Marcar/desmarcar favorito.
- [ ] Archivar lugar y comprobar que el historial antiguo sigue mostrando su nombre.
- [ ] Restaurar lugar archivado.
- [ ] Buscar ignorando mayúsculas y acentos.
- [ ] Filtrar por categoría.

## 6. Registro rápido y automatización local

- [ ] Seleccionar un lugar sugiere el tipo más frecuente según datos cargados.
- [ ] Crear plantilla Lugar + Actividad + Nota.
- [ ] Usar una plantilla rellena el registro rápido.
- [ ] Reordenar plantillas con ↑/↓.
- [ ] Reordenar plantillas arrastrando en el panel compatible.
- [ ] Crear/eliminar notas rápidas.
- [ ] Repetir última actividad.
- [ ] Repetir una actividad del historial deja fecha/hora actuales y valor vacío.

## 7. Jornada y pendientes

- [ ] Crear una parada pendiente para hoy.
- [ ] Marcar una parada como realizada desde Jornada.
- [ ] Editar una parada.
- [ ] Finalizar jornada muestra el resumen del día.
- [ ] Pasar pendientes al día siguiente conserva la información principal.
- [ ] Las prioridades Baja/Media/Alta funcionan.
- [ ] Fecha límite y etiquetas se guardan correctamente.

## 8. Historial

- [ ] Búsqueda ignora acentos/mayúsculas.
- [ ] Filtro Hoy.
- [ ] Filtro Esta semana, incluso si cruza de mes.
- [ ] Filtro Mes.
- [ ] Filtro Pendientes.
- [ ] Filtros de día/rango/lugar/tipo/estado/prioridad/dinero.
- [ ] Exportar CSV respeta los filtros actuales.
- [ ] Editar una fila funciona.
- [ ] Repetir una fila funciona.
- [ ] Enviar a papelera funciona.
- [ ] “Deshacer” restaura la actividad.

## 9. Papelera

- [ ] La actividad eliminada desaparece de las vistas normales.
- [ ] Restaurar devuelve la actividad.
- [ ] Purgar elimina definitivamente el registro.

## 10. Calendario y reportes

- [ ] Calendario muestra intensidad en días con actividad.
- [ ] Tocar un día muestra sus actividades.
- [ ] Cambiar mes carga únicamente el mes solicitado.
- [ ] Reporte muestra total, días, lugares y valores.
- [ ] Ranking de lugares, tipos y estados funciona.
- [ ] Promedio/día, día más activo, hora frecuente y racha se calculan localmente.
- [ ] Comparación con mes anterior funciona si ese mes está disponible.
- [ ] “Analizar año” solo carga los meses del año cuando se solicita.
- [ ] Imprimir reporte usa el diseño de impresión.

## 11. Temas y móvil

- [ ] Modo oscuro.
- [ ] Modo claro.
- [ ] Modo automático sigue el sistema.
- [ ] Cambio rápido desde la barra superior.
- [ ] Colores de acento.
- [ ] Densidad cómoda/compacta.
- [ ] Menú lateral móvil abre/cierra tocando fuera.
- [ ] Navegación inferior móvil funciona.
- [ ] Escape cierra modales no críticos en PC.
- [ ] `prefers-reduced-motion` reduce animaciones.

## 12. Copias e importación

- [ ] Exportar JSON completo.
- [ ] Importar una copia JSON válida.
- [ ] Rechazar JSON que no tiene formato WorkLog.
- [ ] Importar CSV válido.
- [ ] Crear automáticamente un lugar/tipo inexistente al importar CSV.
- [ ] Exportar una copia antes de restaurar datos importantes.

## 13. PWA / Offline

- [ ] `manifest.webmanifest` carga sin errores.
- [ ] `service-worker.js` se registra en localhost/HTTPS.
- [ ] Iconos 192 y 512 aparecen.
- [ ] Instalar la PWA cuando el navegador ofrece el evento de instalación.
- [ ] HTML/CSS/JS pueden abrir desde caché después de la primera carga.
- [ ] El service worker no cachea peticiones de Firestore/Auth como si fueran archivos estáticos.

## 14. Seguridad

- [ ] Publicar `firebase/firestore.rules` V2 antes del uso real.
- [ ] Una cuenta A no puede leer documentos de una cuenta B.
- [ ] La app no utiliza `allow read, write: if true`.
- [ ] No hay Service Account ni claves privadas dentro del frontend.
- [ ] No se usa Firebase Storage, Cloud Functions, Analytics o Cloud Messaging.
- [ ] PIN local se guarda como hash y se entiende como privacidad de interfaz, no cifrado.
- [ ] En dispositivo no confiable se usa caché de memoria y sesión de Auth, no persistencia permanente.

## 15. Prueba de estabilidad recomendada

- [ ] Crear 20 actividades seguidas.
- [ ] Editar varias de ellas.
- [ ] Cambiar al menos una entre dos meses.
- [ ] Archivar/restaurar un lugar y un tipo.
- [ ] Desconectar/reconectar red durante una escritura.
- [ ] Recargar después de sincronizar y comprobar que los datos coinciden con Firestore.
- [ ] Abrir PC y teléfono con la misma cuenta y usar “Sincronizar” para confirmar consistencia.

