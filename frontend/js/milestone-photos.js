/** La identidad, no el índice ni el porcentaje actual, determina la imagen. */
export function milestonePhoto(milestone) {
  return {
    id: milestone.id,
    message: milestone.message,
    src: new URL(milestone.image ?? `assets/milestones/${milestone.id}.webp`, new URL('../', import.meta.url)).href,
    title: milestone.title ?? `Hito ${milestone.percent} %`,
    alt: milestone.alt ?? `Imagen del hito ${milestone.percent} %.`,
  };
}
