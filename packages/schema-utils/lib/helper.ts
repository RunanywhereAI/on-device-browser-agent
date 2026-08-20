/**
 * Type definition for a JSON Schema object
 */
export interface JsonSchemaObject {
  $ref?: string;
  $defs?: Record<string, JsonSchemaObject>;
  type?: string;
  properties?: Record<string, JsonSchemaObject>;
  items?: JsonSchemaObject;
  anyOf?: JsonSchemaObject[];
  title?: string;
  description?: string;
  required?: string[];
  default?: unknown;
  additionalProperties?: boolean;
  [key: string]: unknown;
}

/**
 * Dereferences all $ref fields in a JSON schema by replacing them with the actual referenced schema
 *
 * @param schema The JSON schema to dereference
 * @returns A new JSON schema with all references resolved
 */
export function dereferenceJsonSchema(schema: JsonSchemaObject): JsonSchemaObject {
  // Create a deep copy of the schema to avoid modifying the original
  const clonedSchema = JSON.parse(JSON.stringify(schema));

  // Extract definitions to use for resolving references
  const definitions = clonedSchema.$defs || {};

  // Process the schema
  const result = processSchemaNode(clonedSchema, definitions);

  // Create a new object without $defs
  const resultWithoutDefs: JsonSchemaObject = {};

  // Copy all properties except $defs
  for (const [key, value] of Object.entries(result)) {
    if (key !== '$defs') {
      resultWithoutDefs[key] = value;
    }
  }

  return resultWithoutDefs;
}

/**
 * Process a schema node, resolving all references
 */
function processSchemaNode(node: JsonSchemaObject, definitions: Record<string, JsonSchemaObject>): JsonSchemaObject {
  // If it's not an object or is null, return as is
  if (typeof node !== 'object' || node === null) {
    return node;
  }

  // If it's a reference, resolve it
  if (node.$ref) {
    const refPath = node.$ref.replace('#/$defs/', '');
    const definition = definitions[refPath];
    if (definition) {
      // Process the definition to resolve any nested references
      const processedDefinition = processSchemaNode(definition, definitions);

      // Create a new object that preserves properties from the original node (except $ref)
      const result: JsonSchemaObject = {};

      // First copy properties from the original node except $ref
      for (const [key, value] of Object.entries(node)) {
        if (key !== '$ref') {
          result[key] = value;
        }
      }

      // Then copy properties from the processed definition
      // Don't override any existing properties in the original node
      for (const [key, value] of Object.entries(processedDefinition)) {
        if (result[key] === undefined) {
          result[key] = value;
        }
      }

      return result;
    }
  }

  // Handle anyOf for references
  if (node.anyOf) {
    // Process each item in anyOf
    const processedAnyOf = node.anyOf.map(item => processSchemaNode(item, definitions));

    // If anyOf contains a reference and a null type, merge them
    const nonNullTypes = processedAnyOf.filter(item => item.type !== 'null');
    const hasNullType = processedAnyOf.some(item => item.type === 'null');

    if (nonNullTypes.length === 1 && hasNullType) {
      // Create a result that preserves all properties from the original node
      const result: JsonSchemaObject = {};

      // Copy all properties from original node except anyOf
      for (const [key, value] of Object.entries(node)) {
        if (key !== 'anyOf') {
          result[key] = value;
        }
      }

      // Merge in properties from the non-null type
      for (const [key, value] of Object.entries(nonNullTypes[0])) {
        // Don't override properties that were in the original node
        if (result[key] === undefined) {
          result[key] = value;
        }
      }

      result.nullable = true;
      return result;
    }

    // Otherwise, keep the anyOf structure but with processed items
    return {
      ...node,
      anyOf: processedAnyOf,
    };
  }

  // Create a new node with processed properties
  const result: JsonSchemaObject = {};

  // Copy all properties except $ref
  for (const [key, value] of Object.entries(node)) {
    if (key !== '$ref') {
      if (key === 'properties' && typeof value === 'object' && value !== null) {
        // Process properties
        result.properties = {};
        for (const [propKey, propValue] of Object.entries(value)) {
          result.properties[propKey] = processSchemaNode(propValue as JsonSchemaObject, definitions);
        }
      } else if (key === 'items' && typeof value === 'object' && value !== null) {
        // Process items for arrays
        result.items = processSchemaNode(value as JsonSchemaObject, definitions);
      } else {
        // Copy other properties as is
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Converts an OpenAI format JSON schema to a Google Gemini compatible schema
 *
 * Key differences handled:
 * 1. OpenAI accepts $defs and $ref for references, Gemini only accepts inline definitions
 * 2. Different structure for nullable properties
 * 3. Gemini has a flatter structure for defining properties
 * 4. https://ai.google.dev/api/caching#Schema
 * 5. https://ai.google.dev/gemini-api/docs/structured-output?lang=node#json-schemas
 *
 * @param openaiSchema The OpenAI format JSON schema to convert
 * @param ensureOrder If true, adds the propertyOrdering field for consistent ordering
 * @returns A Google Gemini compatible JSON schema
 */
export function convertOpenAISchemaToGemini(openaiSchema: JsonSchemaObject, ensureOrder = false): JsonSchemaObject {
  // First flatten the schema with dereferenceJsonSchema
  const flattenedSchema = dereferenceJsonSchema(openaiSchema);

  // Create a new schema object
  const geminiSchema: JsonSchemaObject = {
    type: flattenedSchema.type,
    properties: {},
    required: flattenedSchema.required || [],
  };

  // Process properties
  if (flattenedSchema.properties) {
    geminiSchema.properties = processPropertiesForGemini(flattenedSchema.properties, ensureOrder);

    // Add propertyOrdering for top-level properties if ensureOrder is true
    if (ensureOrder && geminiSchema.properties) {
      geminiSchema.propertyOrdering = Object.keys(flattenedSchema.properties);
    }
  }

  // Copy other Gemini-compatible fields
  if (flattenedSchema.description) {
    geminiSchema.description = flattenedSchema.description;
  }

  if (flattenedSchema.format) {
    geminiSchema.format = flattenedSchema.format;
  }

  if (flattenedSchema.enum) {
    geminiSchema.enum = flattenedSchema.enum;
  }

  if (flattenedSchema.nullable) {
    geminiSchema.nullable = flattenedSchema.nullable;
  }

  // Handle array items
  if (flattenedSchema.type === 'array' && flattenedSchema.items) {
    geminiSchema.items = processPropertyForGemini(flattenedSchema.items);

    if (flattenedSchema.minItems !== undefined) {
      geminiSchema.minItems = flattenedSchema.minItems;
    }

    if (flattenedSchema.maxItems !== undefined) {
      geminiSchema.maxItems = flattenedSchema.maxItems;
    }
  }

  return geminiSchema;
}

/**
 * Process properties recursively, converting to Gemini format
 */
function processPropertiesForGemini(
  properties: Record<string, JsonSchemaObject>,
  addPropertyOrdering: boolean = false,
): Record<string, JsonSchemaObject> {
  const result: Record<string, JsonSchemaObject> = {};

  for (const [key, value] of Object.entries(properties)) {
    if (typeof value !== 'object' || value === null) continue;

    result[key] = processPropertyForGemini(value, addPropertyOrdering);
  }

  return result;
}

/**
 * Process a single property, converting to Gemini format
 *
 * @param property The property to process
 * @param addPropertyOrdering Whether to add property ordering for object properties
 */
function processPropertyForGemini(property: JsonSchemaObject, addPropertyOrdering = false): JsonSchemaObject {
  // Create a new property object
  const result: JsonSchemaObject = {
    type: property.type,
  };

  // Copy description if it exists
  if (property.description) {
    result.description = property.description;
  }

  // Copy format if it exists
  if (property.format) {
    result.format = property.format;
  }

  // Copy enum if it exists
  if (property.enum) {
    result.enum = property.enum;
  }

  // Copy nullable if it exists
  if (property.nullable) {
    result.nullable = property.nullable;
  }

  // Process nested properties for objects
  if (property.type === 'object' && property.properties) {
    result.properties = processPropertiesForGemini(property.properties, addPropertyOrdering);

    // Copy required fields
    if (property.required) {
      result.required = property.required;
    }

    // Add propertyOrdering for nested object if needed
    if (addPropertyOrdering && property.properties) {
      result.propertyOrdering = Object.keys(property.properties);
    }
    // Copy propertyOrdering if it already exists
    else if (property.propertyOrdering) {
      result.propertyOrdering = property.propertyOrdering;
    }
  }

  // Handle arrays
  if (property.type === 'array' && property.items) {
    result.items = processPropertyForGemini(property.items, addPropertyOrdering);

    if (property.minItems !== undefined) {
      result.minItems = property.minItems;
    }

    if (property.maxItems !== undefined) {
      result.maxItems = property.maxItems;
    }
  }

  return result;
}

export type JSONSchemaType = JsonSchemaObject | JSONSchemaType[];
// Custom stringify function
export function stringifyCustom(value: JSONSchemaType, indent = '', baseIndent = '  '): string {
  const currentIndent = indent + baseIndent;
  if (value === null) {
    return 'null';
  }
  switch (typeof value) {
    case 'string':
      // Escape single quotes within the string if necessary
      return `'${(value as string).replace(/'/g, "\\\\'")}'`;
    case 'number':
    case 'boolean':
      return String(value);
    case 'object': {
      if (Array.isArray(value)) {
        if (value.length === 0) {
          return '[]';
        }
        const items = value.map(item => `${currentIndent}${stringifyCustom(item, currentIndent, baseIndent)}`);
        return `[\n${items.join(',\n')}\n${indent}]`;
      }
      const keys = Object.keys(value);
      if (keys.length === 0) {
        return '{}';
      }
      const properties = keys.map(key => {
        // Assume keys are valid JS identifiers and don't need quotes
        const formattedKey = key;
        const formattedValue = stringifyCustom(value[key] as JSONSchemaType, currentIndent, baseIndent);
        return `${currentIndent}${formattedKey}: ${formattedValue}`;
      });
      return `{\n${properties.join(',\n')}\n${indent}}`;
    }
    default:
      // Handle undefined, etc.
      return 'undefined';
  }
}
