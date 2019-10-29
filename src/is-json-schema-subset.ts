/* tslint:disable:no-console */

import isEqual from 'fast-deep-equal';
import mergeAllOf from 'json-schema-merge-allof';
import RefParser, { JSONSchema } from 'json-schema-ref-parser';

const defaultSchema = 'http://json-schema.org/draft-07/schema#';

function log(...args: any[]) {
	if (process.env.DEBUG) {
		console.log(...args);
	}
}

function all<T>(elements: T[], condition: (val: T) => boolean): boolean {
	for (const el of elements) {
		if (!condition(el)) {
			return false;
		}
	}
	return true;
}

function some<T>(elements: T[], condition: (val: T) => boolean): boolean {
	for (const el of elements) {
		if (condition(el)) {
			return true;
		}
	}
	return false;
}

// function multiple<T>(elements: T[], condition: (val: T) => boolean): boolean {
// 	let matches = 0;
// 	for (const el of elements) {
// 		if (condition(el) && ++matches >= 2) {
// 			return true;
// 		}
// 	}
// 	return false;
// }

function one<T>(elements: T[], condition: (val: T) => boolean): boolean {
	let matches = 0;
	for (const el of elements) {
		if (condition(el) && ++matches >= 2) {
			return false;
		}
	}
	return matches === 1;
}

// function none<T>(elements: T[], condition: (val: T) => boolean): boolean {
// 	for (const el of elements) {
// 		if (condition(el)) {
// 			return false;
// 		}
// 	}
// 	return true;
// }

function typeMatches(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean
): boolean {
	const match =
		input.type === target.type ||
		(target.type === 'number' && input.type === 'integer');

	if (!match) {
		// tslint:disable-next-line:no-unused-expression

		log(`Type mismatch: ${input.type} does not satisfy ${target.type}`);
	}
	return match;
}

function inputHasRequiredProps(input: JSONSchema, target: JSONSchema): boolean {
	// Verify that the target doesn't require anything missing from the input
	const inputRequires = new Set(input.required || []);
	for (const prop of target.required || []) {
		if (!inputRequires.has(prop)) {
			// tslint:disable-next-line:no-unused-expression

			log('input does not require necessary property', prop);
			return false;
		}
	}

	return true;
}

function inputHasNoExtraneousProps(
	input: JSONSchema,
	target: JSONSchema
): boolean {
	// Verify that the input doesn't have extra properties violating the target
	if (target.additionalProperties === false) {
		const superProps = new Set(Object.keys(target.properties));
		for (const prop of Object.keys(input.properties || {})) {
			if (!superProps.has(prop)) {
				// tslint:disable-next-line:no-unused-expression
				log('input has extraneous property', prop);
				return false;
			}
		}
	}

	return true;
}

function inputPropertiesMatch(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	const subProps = (input.properties || {}) as {
		[k: string]: JSONSchema;
	};
	const superProps = (target.properties || {}) as {
		[k: string]: JSONSchema;
	};

	for (const prop of Object.keys(superProps)) {
		if (!subProps || !Object.prototype.hasOwnProperty.call(subProps, prop)) {
			continue;
		}

		if (
			!satisfies(
				subProps[prop],
				superProps[prop],
				allowPartial,
				allowAdditionalProps
			)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('Property', prop, 'does not match');
			return false;
		}
	}

	return true;
}

function stringRulesMatch(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean
): boolean {
	if (target.type !== 'string') {
		return true; // nop
	}

	if (target.format && target.format !== input.format) {
		let compatible;
		switch (target.format) {
			case 'idn-email':
				compatible = input.format === 'email';
				break;
			case 'idn-hostname':
				compatible = input.format === 'hostname';
				break;
			case 'iri':
				compatible = input.format === 'uri' || input.format === 'iri';
				break;
			case 'iri-reference':
				compatible =
					input.format === 'uri' ||
					input.format === 'uri-reference' ||
					input.format === 'iri';
				break;
			case 'uri-reference':
				compatible = input.format === 'uri';
				break;
			default:
				compatible = false;
				break;
		}
		if (!compatible) {
			// tslint:disable-next-line:no-unused-expression
			log('String format mismatch');
			return false;
		}
	}

	if (target.pattern && target.pattern !== input.pattern) {
		// tslint:disable-next-line:no-unused-expression
		log('String pattern mismatch');
		return false;
	}

	if (
		target.hasOwnProperty('minLength') &&
		(!input.hasOwnProperty('minLength') || input.minLength < target.minLength)
	) {
		log('input minLength is less than target');
		return false;
	}
	if (
		target.hasOwnProperty('maxLength') &&
		(!input.hasOwnProperty('maxLength') || input.maxLength > target.maxLength)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input maxLength is less than target');
		return false;
	}

	if (target.hasOwnProperty('enum')) {
		if (!input.hasOwnProperty('enum')) {
			// tslint:disable-next-line:no-unused-expression
			log('input is missing enum');
			return false;
		}
		const enums = new Set(target.enum);
		for (const e of input.enum) {
			if (!enums.has(e)) {
				// tslint:disable-next-line:no-unused-expression
				log('target', Array.from(enums), 'is missing enum:', e);
				return false;
			}
		}
	}

	return true;
}

function arrayRulesMatch(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	if (target.type !== 'array') {
		return true; // nop
	}

	if (
		target.hasOwnProperty('minItems') &&
		(!input.hasOwnProperty('minItems') || input.minItems < target.minItems)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input minItems is less than target');
		return false;
	}
	if (
		target.hasOwnProperty('maxItems') &&
		(!input.hasOwnProperty('maxItems') || input.maxItems > target.maxItems)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input maxItems is more than target');
		return false;
	}

	if (Array.isArray(target.items)) {
		if (!input.hasOwnProperty('items')) {
			log('input is missing items');
			return false;
		}

		if (
			!Array.isArray(input.items) ||
			target.items.length !== input.items.length
		) {
			// tslint:disable-next-line:no-unused-expression
			log('Tuple item count mismatch');
			return false;
		}
		for (let i = 0, len = target.items.length; i < len; i++) {
			if (
				!satisfies(
					input.items[i] as JSONSchema,
					target.items[i] as JSONSchema,
					allowPartial,
					allowAdditionalProps
				)
			) {
				// tslint:disable-next-line:no-unused-expression
				log('Tuple items mismatch (see previous error)');
				return false;
			}
		}
	} else {
		if (
			!satisfies(
				input.items as JSONSchema,
				target.items as JSONSchema,
				allowPartial,
				allowAdditionalProps
			)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('Array items mismatch (see previous error)');
			return false;
		}
	}

	if (target.uniqueItems && !input.uniqueItems) {
		// tslint:disable-next-line:no-unused-expression
		log('input does not require uniqueItems');
		return false;
	}

	return true;
}

function numRulesMatch(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean
): boolean {
	if (target.type !== 'integer' && target.type !== 'number') {
		return true; // nop
	}

	if (target.hasOwnProperty('maximum')) {
		if (
			!input.hasOwnProperty('maximum') &&
			!input.hasOwnProperty('exclusiveMaximum')
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input has no maximum property');
			return false;
		}

		if (
			input.hasOwnProperty('maximum') &&
			(input.maximum as number) > (target.maximum as number)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater maximum');
			return false;
		}
		if (
			input.hasOwnProperty('exclusiveMaximum') &&
			(input.exclusiveMaximum as number) > (target.maximum as number)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater maximum (exclusive)');
			return false;
		}
	}

	if (target.hasOwnProperty('exclusiveMaximum')) {
		if (
			!input.hasOwnProperty('maximum') &&
			!input.hasOwnProperty('exclusiveMaximum')
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input has no maximum property');
			return false;
		}

		if (
			input.hasOwnProperty('maximum') &&
			input.maximum >= target.exclusiveMaximum
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater maximum');
			return false;
		}
		if (
			input.hasOwnProperty('exclusiveMaximum') &&
			(input.exclusiveMaximum as number) > (target.exclusiveMaximum as number)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater exclusiveMaximum');
			return false;
		}
	}

	if (target.hasOwnProperty('minimum')) {
		if (
			!input.hasOwnProperty('minimum') &&
			!input.hasOwnProperty('exclusiveMinimum')
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input has no minimum property');
			return false;
		}

		if (input.hasOwnProperty('minimum') && input.minimum < target.minimum) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater minimum');
			return false;
		}
		if (
			input.hasOwnProperty('exclusiveMinimum') &&
			input.exclusiveMinimum < target.minimum
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater minimum');
			return false;
		}
	}

	if (target.hasOwnProperty('exclusiveMinimum')) {
		if (
			!input.hasOwnProperty('minimum') &&
			!input.hasOwnProperty('exclusiveMinimum')
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input has no minimum property');
			return false;
		}

		if (
			input.hasOwnProperty('minimum') &&
			(input.minimum as number) <= (target.exclusiveMinimum as number)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits smaller minimum');
			return false;
		}
		if (
			input.hasOwnProperty('exclusiveMinimum') &&
			(input.exclusiveMinimum as number) < (target.exclusiveMinimum as number)
		) {
			// tslint:disable-next-line:no-unused-expression
			log('input permits greater exclusiveMinimum');
			return false;
		}
	}

	if (target.multipleOf) {
		if (!input.multipleOf) {
			// tslint:disable-next-line:no-unused-expression
			log('input lacks multipleOf');
			return false;
		}
		if (input.multipleOf % target.multipleOf !== 0) {
			// tslint:disable-next-line:no-unused-expression

			log('input multipleOf is not an integer multiple of target multipleOf');
			return false;
		}
	}

	return true;
}

function constMatch(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean
): boolean {
	if (target.const && target.const !== input.const) {
		// tslint:disable-next-line:no-unused-expression

		log(`input const mismatch (${target.const} !== ${input.const})`);
		return false;
	}

	return true;
}

function allOfMatches(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	if (
		input.allOf &&
		!all(input.allOf as JSONSchema[], (e) =>
			satisfies(e, target, allowPartial, allowAdditionalProps)
		)
	) {
		return false;
	}

	if (
		target.allOf &&
		!all(target.allOf as JSONSchema[], (e) =>
			satisfies(input, e, allowPartial, allowAdditionalProps)
		)
	) {
		return false;
	}

	return true;
}

function anyOfMatches(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	// If input can be anyOf [a,b,...], then each of them must be accepted
	// by the target.
	if (
		input.anyOf &&
		!all(input.anyOf as JSONSchema[], (e) =>
			satisfies(e, target, allowPartial, allowAdditionalProps)
		)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('Some input.anyOf elements do not satisfy target');
		return false;
	}

	// If the target can accept anyOf [a,b,...], then it's enough
	// that at least one is satisfied by the input
	if (
		target.anyOf &&
		!some(target.anyOf as JSONSchema[], (e) =>
			satisfies(input, e, allowPartial, allowAdditionalProps)
		)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input does not satisfy any of target.anyOf');
		return false;
	}

	return true;
}

function oneOfMatches(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	if (
		input.oneOf &&
		!all(input.oneOf as JSONSchema[], (e) =>
			satisfies(e, target, allowPartial, allowAdditionalProps)
		)
	) {
		// tslint:disable-next-line:no-unused-expression

		log('Some input.oneOf elements do not satisfy target');
		return false;
	}

	if (
		target.oneOf &&
		!one(target.oneOf as JSONSchema[], (e) =>
			satisfies(input, e, allowPartial, allowAdditionalProps)
		)
	) {
		// tslint:disable-next-line:no-unused-expression

		log('input does not satisfy exactly one of target.oneOf');
		return false;
	}

	return true;
}

function notMatches(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	if (
		input.not &&
		satisfies(
			input.not as JSONSchema,
			target,
			allowPartial,
			allowAdditionalProps
		)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input.not should not satisfy target');
		return false;
	}

	if (
		target.not &&
		satisfies(
			input,
			target.not as JSONSchema,
			allowPartial,
			allowAdditionalProps
		)
	) {
		// tslint:disable-next-line:no-unused-expression
		log('input should not satisfy target.not');
		return false;
	}

	return true;
}

function satisfies(
	input: JSONSchema,
	target: JSONSchema,
	allowPartial: boolean,
	allowAdditionalProps: boolean
): boolean {
	if (isEqual(input, target)) {
		return true;
	} else if (isEqual(target, {})) {
		return true;
	}

	const draftRegex = /draft-0[1234]\/schema/;
	if (
		draftRegex.test(input.$schema || '') ||
		draftRegex.test(target.$schema || '')
	) {
		throw new Error('Requires JSON schema draft version 5+');
	}

	if (target.anyOf || input.anyOf) {
		return anyOfMatches(input, target, allowPartial, allowAdditionalProps);
	} else if (target.allOf || input.allOf) {
		return allOfMatches(input, target, allowPartial, allowAdditionalProps);
	} else if (target.oneOf || input.oneOf) {
		return oneOfMatches(input, target, allowPartial, allowAdditionalProps);
	}

	const validators = [
		arrayRulesMatch,
		constMatch,
		numRulesMatch,
		stringRulesMatch,
		inputHasNoExtraneousProps,
		inputHasRequiredProps,
		inputPropertiesMatch,
		typeMatches,

		anyOfMatches,
		oneOfMatches,
		notMatches,
	];
	if (!allowAdditionalProps) {
		validators.push(inputHasNoExtraneousProps);
	}

	for (const validator of validators) {
		if (!validator(input, target, allowPartial, allowAdditionalProps)) {
			// tslint:disable-next-line:no-unused-expression
			log('Validator failed:', validator.name);
			return false;
		}
	}

	return true;
}

export { JSONSchema };
export default async function inputSatisfies(
	input: JSONSchema,
	target: JSONSchema,
	opts:
		| boolean
		| { allowPartial?: boolean; allowAdditionalProps?: boolean } = false
): Promise<boolean> {
	let allowPartial = false;
	let allowAdditionalProps = false;
	if (typeof opts === 'boolean') {
		allowPartial = opts;
	} else if (typeof opts === 'object' && opts !== null) {
		allowPartial = opts.allowPartial;
		allowAdditionalProps = opts.allowAdditionalProps;
	}

	const [sub, sup] = await Promise.all([
		RefParser.dereference(
			input.$schema ? input : { ...input, $schema: defaultSchema }
		),
		RefParser.dereference(
			target.$schema ? target : { ...target, $schema: defaultSchema }
		),
	]);
	return satisfies(
		mergeAllOf(sub),
		mergeAllOf(sup),
		allowPartial,
		allowAdditionalProps
	);
}
