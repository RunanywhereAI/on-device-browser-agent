import { dereferenceJsonSchema, stringifyCustom } from '../lib/helper.js';
import { jsonNavigatorOutputSchema } from '../lib/json_schema.js';

/**
 * This example demonstrates how to flatten the jsonNavigatorOutputSchema
 * by dereferencing all $ref fields and removing the $defs section.
 */

// Flatten the schema by dereferencing all references
console.log('Flattening jsonNavigatorOutputSchema...');
const flattenedSchema = dereferenceJsonSchema(jsonNavigatorOutputSchema);

// Pretty print the flattened schema using the custom function
console.log('Flattened Schema (Custom Format):');
console.log(stringifyCustom(flattenedSchema));

// You can also see the size difference
const originalSize = JSON.stringify(jsonNavigatorOutputSchema).length;
const flattenedSize = JSON.stringify(flattenedSchema).length;

console.log('\nSize comparison:');
console.log(`Original schema size: ${originalSize} bytes`);
console.log(`Flattened schema size: ${flattenedSize} bytes`);
console.log(
  `Difference: ${flattenedSize - originalSize} bytes (${((flattenedSize / originalSize) * 100).toFixed(2)}% of original)`,
);

// Note: The flattened schema is typically larger because references are replaced with their full definitions
