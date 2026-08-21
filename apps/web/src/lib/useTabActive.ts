import { useEffect, useState } from "react";

/**
 * Se suscribe a los <input type="radio" name={radioGroupName}> que
 * controlan las pestañas de /combates (y el equivalente en el landing) y
 * devuelve si la pestaña con id === panelInputId esta actualmente activa.
 *
 * Necesario porque el sistema de tabs de este sitio es CSS puro
 * (:checked ~ ... { display: block }, ver combates.astro/index.astro) --
 * los componentes React de ambos paneles se montan siempre, aunque uno
 * este oculto con display:none. Sin esto, el timer de SequentialReveal
 * del panel oculto seguiria corriendo de fondo y podria terminar
 * (marcando la revelacion como "vista") antes de que el usuario cambie a
 * esa pestaña y realmente la vea.
 *
 * Si no hay tabs en la pagina (radioGroupName no existe, ej. si este
 * gate se usa suelto sin el shell de tabs), devuelve true siempre --
 * el gate se comporta como si estuviera solo/visible.
 */
export function useTabActive(radioGroupName: string, panelInputId: string): boolean {
  const [active, setActive] = useState(() => {
    if (typeof document === "undefined") return true;
    const input = document.getElementById(panelInputId) as HTMLInputElement | null;
    return input ? input.checked : true;
  });

  useEffect(() => {
    if (typeof document === "undefined") return;
    const inputs = document.querySelectorAll<HTMLInputElement>(`input[name="${radioGroupName}"]`);
    if (inputs.length === 0) return;

    function sync() {
      const input = document.getElementById(panelInputId) as HTMLInputElement | null;
      setActive(input ? input.checked : true);
    }

    sync();
    inputs.forEach((input) => input.addEventListener("change", sync));
    return () => inputs.forEach((input) => input.removeEventListener("change", sync));
  }, [radioGroupName, panelInputId]);

  return active;
}
