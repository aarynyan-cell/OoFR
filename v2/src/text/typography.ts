// French puts a space before ? ! : ; » and after «. Making it a no-break space
// keeps "aujourd'hui ?" together instead of leaving "?" alone on a new line.
export function frenchSpacing(text: string): string {
  return text.replace(/ ([?!:;»])/g, " $1").replace(/« /g, "« ");
}
