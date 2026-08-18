# Imágenes del proyecto — dónde van y cómo se llaman

Hay DOS formas de poner fotos, según el caso. Leé cuál te aplica.

## 1. Fotos reales de cada peleador (el caso normal)

**No se suben archivos a mano.** Cada participante sube su propia foto desde
`/inscripcion` (o el admin la sube por él desde `/gestion-roster-x9f2`), con
un `<input type="file">` en el formulario. El código la manda a Supabase
Storage (bucket `participant-photos`) y guarda la URL pública resultante en
la columna `photo` de la tabla `participants`.

O sea: si ya tenés las 14+ fotos de los amigos, la forma correcta de
cargarlas es:
1. Que cada uno se registre en `/inscripcion` y suba su propia foto, **o**
2. Vos como admin entrás a `/gestion-roster-x9f2`, editás cada participante
   y le subís la foto ahí con el mismo campo de archivo.

No hace falta nombrar los archivos de ninguna forma especial — el código
les pone un nombre único (`{id}-{timestamp}.{extension}`) al subirlos.

`participant.photo` se usa en la card del roster y en la ficha de detalle
(`/peleadores/[id]`). `participant.banner` es una segunda foto opcional,
mas panoramica, que se usa como fondo grande en el panel de selección del
landing (`ChampionSelectGrid`) cuando el usuario elige ese peleador — si no
la subió, cae a `photo`. Ambas se suben desde el mismo formulario en
`/inscripcion` o `/gestion-roster-x9f2`, con dos campos de archivo
separados.

El `HeroBanner` de la home (el del cronómetro) usa una imagen de fondo fija
del sitio, no una foto de peleador: `apps/web/public/images/hero-banner.jpg`.

## 2. Datos de ejemplo / fallback local (`participants.yml`)

Si querés cargar datos de prueba sin tocar Supabase (o como fallback si
Supabase no está configurado), el archivo
`apps/web/src/data/participants.yml` referencia fotos así:

```yaml
photo: "/images/participants/p1.webp"
```

Esas rutas son relativas a `apps/web/public/`, que hoy solo tiene
`.assetsignore` — la carpeta `images/participants/` **no existe todavía**.
Si querés usar este modo:

1. Creá `apps/web/public/images/participants/`
2. Poné ahí un archivo por peleador, nombrado igual al `id` que le diste en
   el YAML: `p1.webp`, `p2.webp`, etc. (o el nombre que uses en `id:`,
   siempre y cuando coincida con el string en `photo:`).
3. Formato recomendado: `.webp`, relación de aspecto vertical tipo 4:5
   (retrato), mínimo ~800x1000px — así se ve bien tanto en la card chica
   como en la ficha de detalle grande.

**Importante:** esto solo aplica al modo demo/fallback. En producción, con
Supabase configurado y participantes reales cargados desde `/inscripcion`,
el sitio ignora `participants.yml` por completo y usa lo que esté en la
base de datos.

## Resumen rápido

| Caso | Dónde | Cómo se nombra |
|---|---|---|
| Fotos reales de los amigos | Subida por formulario en `/inscripcion` o `/gestion-roster-x9f2` | Automático, no importa |
| Datos de prueba/demo local | `apps/web/public/images/participants/` | Igual al `id:` del YAML, ej. `p1.webp` |
