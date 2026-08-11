import { normalizePath, type Plugin, type ResolvedConfig } from "vite";
import path from "path";
import fs from "fs";
import { optimize } from "svgo";

const virtualModuleId = "svg-merge-attributes";

const ATTR_REGEX = /([a-z0-9_-]+)="([^"]*)"/gim;

const SVG_USE_REGEX =
  /<use\s+([^>]*?)svg="([^"]+\.svg)"([^>]*)\/?>/gim;

function parseAttrs(str: string): Record<string, string> {
  const out: Record<string, string> = {};

  for (const [, name, value] of str.matchAll(ATTR_REGEX)) {
    out[name] = value;
  }

  return out;
}

function mergeSvgAttributes(
  svg: string,
  attrs: Record<string, string>,
): string {
  return svg.replace(
    /<svg([^>]*)>/i,
    (_match: string, existingAttrs: string | undefined): string => {
      if (attrs["size"]) {
        attrs["width"] = attrs["size"];
        attrs["height"] = attrs["size"];
        delete attrs["size"];
      }

      const map = new Map<string, string>();

      for (const [, name, value] of (existingAttrs ?? "").matchAll(
        ATTR_REGEX,
      )) {
        map.set(name, value);
      }

      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class" && map.has("class")) {
          map.set("class", `${map.get("class")} ${value}`);
        } else if (key === "style" && map.has("style")) {
          map.set("style", `${map.get("style")};${value}`);
        } else {
          map.set(key, value);
        }
      }

      const merged = [...map.entries()]
        .map(([key, value]) => `${key}="${value}"`)
        .join(" ");

      return `<svg ${merged}>`;
    },
  );
}

function getParams(str: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(str).entries());
}

function getResizer(
  base: string,
  params: string,
): (size: number, attrs?: Record<string, string>) => string {
  const cache: Record<string, string> = {};

  return function getIcon(
    size: number,
    attrs: Record<string, string> = {},
  ): string {
    const attributes: Record<string, string> = {
      ...getParams(params),
      ...attrs,
      height: size.toString(),
      width: size.toString(),
    };

    const key = JSON.stringify(attributes);

    if (!cache[key]) {
      cache[key] = mergeSvgAttributes(base, attributes);
    }

    return cache[key];
  };
}

function loadSvg(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export default function viteSvgUsePlugin(): Plugin {
  let config: ResolvedConfig;
  const watched = new Set<string>();

  function resolveAlias(file: string): string {
    if (config?.resolve?.alias) {
      for (const alias of config.resolve.alias) {
        const { find, replacement } = alias;

        const matches =
          typeof find === "string"
            ? file.startsWith(find)
            : find.test(file);

        if (!matches) {
          continue;
        }

        const remainder =
          typeof find === "string"
            ? file.slice(find.length)
            : file.replace(find, "");

        const cleanReplacement = replacement.replace(
          /^[/\\]+/,
          "",
        );

        const cleanRemainder = remainder.replace(
          /^[/\\]+/,
          "",
        );

        return normalizePath(
          path.resolve(
            config.root,
            cleanReplacement,
            cleanRemainder,
          ),
        );
      }
    }

    return normalizePath(
      path.isAbsolute(file)
        ? file
        : path.resolve(config.root, file),
    );
  }

  function loadOptimizedSvg(filePath: string): string {
    const svg = loadSvg(filePath);
    return optimize(svg).data;
  }

  return {
    name: "vite-svg-use-plugin",
    enforce: "pre",

    configResolved(resolvedConfig: ResolvedConfig): void {
      config = resolvedConfig;
    },

    transformIndexHtml: {
      order: "pre",

      async handler(
        html: string,
        ctx: { filename?: string },
      ): Promise<string> {
        return html.replace(
          SVG_USE_REGEX,
          (
            _full: string,
            before: string | undefined,
            src: string | undefined,
            after: string | undefined,
          ): string => {
            const attrs: Record<string, string> = {
              ...parseAttrs(before || ""),
              ...parseAttrs(after || ""),
            };

            delete attrs["use"];

            const filePath = resolveAlias(src || "");

            watched.add(filePath);

            const svg = loadOptimizedSvg(filePath);

            return mergeSvgAttributes(svg, attrs);
          },
        );
      },
    },

    resolveId(id: string): string | null {
      if (id === virtualModuleId) {
        return id;
      }

      return null;
    },

    load(id: string): string | null {
      if (id === virtualModuleId) {
        return [
          `const ATTR_REGEX = ${ATTR_REGEX};`,
          `export function getParams(str) {`,
          `  return Object.fromEntries(new URLSearchParams(str).entries());`,
          `}`,
          `export function mergeSvgAttributes(svg, attrs) {`,
          `  return svg.replace(/<svg([^>]*)>/i, (_match, existingAttrs) => {`,
          `    if (attrs["size"]) {`,
          `      attrs["width"] = attrs["size"];`,
          `      attrs["height"] = attrs["size"];`,
          `      delete attrs["size"];`,
          `    }`,
          `    const map = new Map();`,
          `    for (const [, name, value] of (existingAttrs || "").matchAll(ATTR_REGEX)) {`,
          `      map.set(name, value);`,
          `    }`,
          `    for (const [key, value] of Object.entries(attrs)) {`,
          `      if (key === "class" && map.has("class")) {`,
          `        map.set("class", map.get("class") + " " + value);`,
          `      } else if (key === "style" && map.has("style")) {`,
          `        map.set("style", map.get("style") + ";" + value);`,
          `      } else {`,
          `        map.set(key, value);`,
          `      }`,
          `    }`,
          `    const merged = [...map.entries()].map(([key, value]) => key + '="' + value + '"').join(" ");`,
          `    return "<svg " + merged + ">";`,
          `  });`,
          `}`,
          `export function getResizer(base, params) {`,
          `  const cache = {};`,
          `  return function getIcon(size, attrs = {}) {`,
          `    const attributes = {`,
          `      ...getParams(params),`,
          `      ...attrs,`,
          `      height: String(size),`,
          `      width: String(size),`,
          `    };`,
          `    const key = JSON.stringify(attributes);`,
          `    if (!cache[key]) {`,
          `      cache[key] = mergeSvgAttributes(base, attributes);`,
          `    }`,
          `    return cache[key];`,
          `  };`,
          `}`,
        ].join("\n");
      }

      if (!id.includes("?svg")) {
        return null;
      }

      const [file, queryString = ""] = id.split("?");

      const absPath = resolveAlias(file);
      const params = new URLSearchParams(queryString);

      params.delete("svg");

      watched.add(absPath);

      const svg = loadOptimizedSvg(absPath);

      if (params.has("icon")) {
        params.delete("icon");

        const attributes = getParams(params.toString());

        return [
          `const svg = ${JSON.stringify(svg)};`,
          `const params = ${JSON.stringify(attributes)};`,
          `const cache = {};`,
          `function merge(svg, attrs) {`,
          `  return svg.replace(/<svg([^>]*)>/i, (_match, existingAttrs) => {`,
          `    const map = new Map();`,
          `    for (const [, name, value] of (existingAttrs || "").matchAll(${ATTR_REGEX})) {`,
          `      map.set(name, value);`,
          `    }`,
          `    for (const [key, value] of Object.entries(attrs)) {`,
          `      if (key === "class" && map.has("class")) {`,
          `        map.set("class", map.get("class") + " " + value);`,
          `      } else if (key === "style" && map.has("style")) {`,
          `        map.set("style", map.get("style") + ";" + value);`,
          `      } else {`,
          `        map.set(key, value);`,
          `      }`,
          `    }`,
          `    const merged = [...map.entries()].map(([key, value]) => key + '="' + value + '"').join(" ");`,
          `    return "<svg " + merged + ">";`,
          `  });`,
          `}`,
          `export default function getIcon(size, attrs = {}) {`,
          `  const attributes = {`,
          `    ...params,`,
          `    ...attrs,`,
          `    height: String(size),`,
          `    width: String(size),`,
          `  };`,
          `  const key = JSON.stringify(attributes);`,
          `  if (!cache[key]) {`,
          `    cache[key] = merge(svg, attributes);`,
          `  }`,
          `  return cache[key];`,
          `}`,
        ].join("\n");
      }

      if (params.size === 0) {
        return `export default ${JSON.stringify(svg)};`;
      }

      const attrs = getParams(params.toString());

      return [
        `const svg = ${JSON.stringify(svg)};`,
        `const attrs = ${JSON.stringify(attrs)};`,
        `export default svg.replace(/<svg([^>]*)>/i, (_match, existingAttrs) => {`,
        `  const map = new Map();`,
        `  for (const [, name, value] of (existingAttrs || "").matchAll(${ATTR_REGEX})) {`,
        `    map.set(name, value);`,
        `  }`,
        `  for (const [key, value] of Object.entries(attrs)) {`,
        `    map.set(key, value);`,
        `  }`,
        `  const merged = [...map.entries()].map(([key, value]) => key + '="' + value + '"').join(" ");`,
        `  return "<svg " + merged + ">";`,
        `});`,
      ].join("\n");
    },

    handleHotUpdate({
      file,
      server,
    }: {
      file: string;
      server: {
        ws: {
          send: (message: { type: string }) => void;
        };
      };
    }): void {
      if (watched.has(normalizePath(file))) {
        server.ws.send({
          type: "full-reload",
        });
      }
    },
  };
}
