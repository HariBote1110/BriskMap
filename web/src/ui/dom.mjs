// Minimal DOM helpers.

// el('button', { class: 'x', type: 'button', onclick }, [children])
// `html` is only for trusted static markup (the inline SVG icons).
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of [].concat(children)) if (child !== null && child !== undefined) node.append(child);
  return node;
}

// Splits a template such as 'Turn on {setting} in {file}' into text and the given nodes.
export function templateNodes(template, nodes) {
  return template.split(/\{([a-zA-Z]+)\}/).map((part, i) =>
    (i % 2 === 1 && nodes[part] ? nodes[part] : i % 2 === 1 ? `{${part}}` : part));
}

// Writes text only when it changed, to keep DOM work to a minimum.
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

export const byId = (id) => document.getElementById(id);
