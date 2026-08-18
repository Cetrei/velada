# Iconos de rol

`ChampionSelectGrid.tsx` carga estos 5 archivos por nombre exacto. Bajarlos
del wiki oficial de LoL y ponerlos en esta carpeta con estos nombres:

| Archivo requerido | Pagina de origen |
|---|---|
| `top.png` | https://wiki.leagueoflegends.com/en-us/File:Top_icon.png |
| `jungle.png` | https://wiki.leagueoflegends.com/en-us/File:Jungle_icon.png |
| `middle.png` | https://wiki.leagueoflegends.com/en-us/File:Middle_icon.png |
| `bottom.png` | https://wiki.leagueoflegends.com/en-us/File:Bottom_icon.png |
| `support.png` | https://wiki.leagueoflegends.com/en-us/File:Support_icon.png |

En cada pagina de archivo, click en la imagen o en el link de tamano
completo (136x136) para bajar el original, no el thumbnail de 120px.

Si un archivo falta, el `<img onError>` en `ChampionSelectGrid.tsx` lo
oculta en vez de mostrar el icono roto del navegador — no rompe el resto
del grid mientras tanto.

Los iconos vienen en gris/blanco sobre transparente; el componente los
tinte con `filter` CSS (dorado en reposo, cyan cuando el filtro esta
activo). Si el resultado se ve raro con los PNG reales, es mas facil
ajustar los valores de `filter` en el `<style>` de `ChampionSelectGrid.tsx`
que tocar los PNG.
