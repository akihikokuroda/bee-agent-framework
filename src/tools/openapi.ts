/**
 * Copyright 2024 IBM Corp.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { join } from "path";

import {
  BaseToolOptions,
  BaseToolRunOptions,
  JSONToolOutput,
  StringToolOutput,
  Tool,
  ToolError,
  ToolEmitter,
} from "@/tools/base.js";
import { Callback, Emitter } from "@/emitter/emitter.js";
import { GetRunContext } from "@/context.js";
import { ValueError } from "@/errors.js";
import { SchemaObject } from "ajv";
import { parse } from "yaml";
import { isEmpty } from "remeda";

export interface OpenAPIOptions extends BaseToolOptions {
  name: string;
  description?: string;
  openApiSchema?: any;
  apiKey?: string;
  http_proxy_url?: string;
}

type ToolRunOptions = BaseToolRunOptions;

export interface OpenAPIResponse {
  numFound: number;
  start: number;
  numFoundExact: boolean;
  q: string;
  offset: number;
  docs: Record<string, any>[];
}

export class OpenAPIToolOutput extends JSONToolOutput<OpenAPIResponse> {
  isEmpty(): boolean {
    return !this.result || this.result.numFound === 0 || this.result.docs.length === 0;
  }
}

export class OpenAPI extends Tool<StringToolOutput, OpenAPIOptions, ToolRunOptions> {
  name = "OpenAPI";
  description = `OpenAPI tool that performs REST API requests to the servers and retrieves the response. The server API interfaces are defined in OpenAPI schema. 
Only use the OpenAPI tool if you need to communicate to external servers.`;
  openApiSchema: any;
  protected apiKey?: string;
  protected http_proxy_url?: string;

  inputSchema() {
    return {
      type: "object",
      required: ["path", "method"],
      oneOf: Object.entries(this.openApiSchema.paths).flatMap(([path, pathSpec]: [string, any]) =>
        Object.entries(pathSpec).map(([method, methodSpec]: [string, any]) => ({
          additionalProperties: false,
          properties: {
            path: {
              const: path,
              description:
                "Do not replace variables in path, instead of, put them to the parameters object.",
            },
            method: { const: method, description: methodSpec.summary || methodSpec.description },
            ...(methodSpec.requestBody?.content?.["application/json"]?.schema
              ? {
                  body: methodSpec.requestBody?.content?.["application/json"]?.schema,
                }
              : {}),
            ...(methodSpec.parameters
              ? {
                  parameters: {
                    type: "object",
                    additionalProperties: false,
                    required: methodSpec.parameters
                      .filter((p: any) => p.required === true)
                      .map((p: any) => p.name),
                    properties: methodSpec.parameters.reduce(
                      (acc: any, p: any) => ({
                        ...acc,
                        [p.name]: { ...p.schema, description: p.name },
                      }),
                      {},
                    ),
                  },
                }
              : {}),
          },
        })),
      ),
    } as const satisfies SchemaObject;
  }

  public readonly emitter: ToolEmitter<
    //ToolInput<this>,
    any,
    StringToolOutput,
    {
      beforeFetch: Callback<{ request: { url: string; options: RequestInit } }>;
      afterFetch: Callback<{ data: OpenAPIResponse }>;
    }
  > = Emitter.root.child({
    namespace: ["tool", "web", "openAPI"],
    creator: this,
  });

  static {
    this.register();
  }

  public constructor({ openApiSchema, apiKey, http_proxy_url, ...rest }: OpenAPIOptions) {
    super({ ...rest });
    this.apiKey = apiKey;
    this.http_proxy_url = http_proxy_url;
    this.openApiSchema = parse(openApiSchema);
    // TODO: #105 review error codes. Were using APIErrorCode, now ToolError
    if (!this.openApiSchema?.paths) {
      throw new ValueError("Server is not specified!");
    }
  }

  protected async _run(
    input: any,
    _options: Partial<ToolRunOptions>,
    run: GetRunContext<typeof this>,
  ) {
    let path: string = input.path || "";
    const url = new URL(this.openApiSchema.servers[0].url);
    Object.keys(input.parameters ?? {}).forEach((key) => {
      const value = input.parameters[key];
      const newPath = path.replace(`{${key}}`, value);
      if (newPath == path) {
        url.searchParams.append(key, value);
      } else {
        path = newPath;
      }
    });
    url.pathname = join(url.pathname, path);
    // eslint-disable-next-line @typescript-eslint/consistent-indexed-object-style
    const headers: { [key: string]: string } = { Accept: "application/json" };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer this.apiKey`;
    }
    try {
      const response = await fetch(url.toString(), {
        body: !isEmpty(input.body) ? input.body : undefined,
        method: input.method.toLowerCase(),
        headers: headers,
        signal: AbortSignal.any([AbortSignal.timeout(30_000), run.signal]),
      });
      return new StringToolOutput(await response.text());
    } catch {
      throw new ToolError(`Request to ${url} failed.`);
    }
  }
}
