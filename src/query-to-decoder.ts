/**
 * Copyright (c) 2016, John Hewson
 * All rights reserved.
 */

/// <reference path="../typings/graphql-types.d.ts" />
/// <reference path="../typings/graphql-language.d.ts" />
/// <reference path="../typings/graphql-utilities.d.ts" />

import {
  OperationDefinition,
  FragmentDefinition,
  FragmentSpread,
  InlineFragment,
  SelectionSet,
  Field,
  Document,
  parse
} from "graphql/language";

import {
  ElmFieldDecl,
  ElmDecl,
  ElmTypeDecl,
  ElmParameterDecl,
  ElmExpr,
  moduleToString,
  typeToString
} from './elm-ast';

import {
  GraphQLSchema,
  GraphQLNonNull,
  GraphQLList,
  GraphQLScalarType,
  GraphQLEnumType,
  GraphQLType,
  GraphQLInputType,
  GraphQLUnionType
} from 'graphql/type';

import {
  TypeInfo,
  buildClientSchema,
  introspectionQuery,
  typeFromAST,
} from 'graphql/utilities';

import {
  FragmentDefinitionMap,
  GraphQLEnumMap,
  elmSafeName,
  typeToElm
} from './query-to-elm';

export function decoderForQuery(def: OperationDefinition, info: TypeInfo,
                                schema: GraphQLSchema, fragmentDefinitionMap: FragmentDefinitionMap,
                                seenFragments: FragmentDefinitionMap): ElmExpr {
  return decoderFor(def, info, schema, fragmentDefinitionMap, seenFragments);
}

export function decoderForFragment(def: FragmentDefinition, info: TypeInfo,
                                schema: GraphQLSchema, fragmentDefinitionMap: FragmentDefinitionMap,
                                seenFragments: FragmentDefinitionMap): ElmExpr {
  return decoderFor(def, info, schema, fragmentDefinitionMap, seenFragments);
}

export function decoderFor(def: OperationDefinition | FragmentDefinition, info: TypeInfo,
                           schema: GraphQLSchema, fragmentDefinitionMap: FragmentDefinitionMap,
                           seenFragments: FragmentDefinitionMap): ElmExpr {

  function walkDefinition(def: OperationDefinition | FragmentDefinition, info: TypeInfo) {
    if (def.kind == 'OperationDefinition') {
      return walkOperationDefinition(<OperationDefinition>def, info);
    } else if (def.kind == 'FragmentDefinition') {
      return walkFragmentDefinition(<FragmentDefinition>def, info);
    }
  }

  function walkOperationDefinition(def: OperationDefinition, info: TypeInfo): ElmExpr {
    info.enter(def);
    if (def.operation == 'query' || def.operation == 'mutation') {
      let decls: Array<ElmDecl> = [];
      // Name
      let name: string;
      if (def.name) {
        name = def.name.value;
      } else {
        name = 'AnonymousQuery';
      }
      let resultType = name[0].toUpperCase() + name.substr(1);
      // todo: Directives
      // SelectionSet
      let expr = walkSelectionSet(def.selectionSet, info);
      // VariableDefinition
      let parameters: Array<ElmParameterDecl> = [];
      if (def.variableDefinitions) {
        for (let varDef of def.variableDefinitions) {
          let name = varDef.variable.name.value;

          let type = typeToString(typeToElm(typeFromAST(schema, varDef.type)), 0);
          // todo: default value
          parameters.push({ name, type });
        }
      }
      info.leave(def);
      
      return { expr: 'map ' + resultType + ' ' + expr.expr };
    }
  }

  function walkFragmentDefinition(def: FragmentDefinition, info: TypeInfo): ElmExpr {
    info.enter(def);

    let name = def.name.value;

    let decls: Array<ElmDecl> = [];
    let resultType = name[0].toUpperCase() + name.substr(1);

    // todo: Directives

    // SelectionSet
    let fields = walkSelectionSet(def.selectionSet, info);

    let fieldNames = getSelectionSetFields(def.selectionSet, info);
    let shape = `(\\${fieldNames.map(f => f + '_').join(' ')} -> { ${fieldNames.map(f => f + ' = ' + f + '_').join(', ')} })`;
    
    info.leave(def);
    return { expr: 'map ' + shape + ' ' + fields.expr };
  }

  function walkSelectionSet(selSet: SelectionSet, info: TypeInfo, seenFields: Array<string> = []): ElmExpr {
    info.enter(selSet);
    let fields: Array<ElmExpr> = [];
    for (let sel of selSet.selections) {
      if (sel.kind == 'Field') {
        let field = <Field>sel;
        var name = field.alias == null ? field.name.value : field.alias.value;
        if (seenFields.indexOf(name) == -1) {
          fields.push(walkField(field, info));
          seenFields.push(name);
        }
      } else if (sel.kind == 'FragmentSpread') {
        // expand out all fragment spreads
        let spreadName = (<FragmentSpread>sel).name.value;
        let def = fragmentDefinitionMap[spreadName];
        fields.push(walkSelectionSet(def.selectionSet, info, seenFields));
      } else if (sel.kind == 'InlineFragment') {
        throw new Error('Should not happen');
      }
    }
    info.leave(selSet);
    return { expr: fields.map(f => f.expr).filter(e => e.length > 0).join('\n        |> apply ') }
  }

  function getSelectionSetFields(selSet: SelectionSet, info: TypeInfo): Array<string> {
    info.enter(selSet);
    let fields: Array<string> = [];
    for (let sel of selSet.selections) {
      if (sel.kind == 'Field') {
        let field = <Field>sel;
        let name = elmSafeName(field.name.value);
        if (field.alias) {
          name = elmSafeName(field.alias.value);
        }
        if (fields.indexOf(name) == -1) {
          fields.push(name);
        }
      } else if (sel.kind == 'FragmentSpread') {
        // expand out all fragment spreads
        let spreadName = (<FragmentSpread>sel).name.value;
        let def = fragmentDefinitionMap[spreadName];
        for (let name of getSelectionSetFields(def.selectionSet, info)) {
          if (fields.indexOf(name) == -1) {
            fields.push(name);
          }
        }
      } else if (sel.kind == 'InlineFragment') {
        throw new Error('Should not happen');
      }
    }
    info.leave(selSet);
    return fields;
  }

  function walkField(field: Field, info: TypeInfo): ElmExpr {
    info.enter(field);
    // Name
    let name = elmSafeName(field.name.value);
    let originalName = field.name.value;

    let info_type = info.getType()
    let isMaybe = false

    let include = field.directives.reduce((acc, {name, arguments: [argument]}) => {
      if (name.value === "include" && !argument.value.value) {
        return false;
      } else if (name.value === "skip" && argument.value.value) {
        return false;
      } else {
        return acc;
      }
    }, true);

    if (info_type instanceof GraphQLNonNull) {
      info_type = info_type['ofType'];
    } else {
      isMaybe = true;
    }
    // Alias
    if (field.alias) {
      name = elmSafeName(field.alias.value);
      originalName = field.alias.value;
    }

    // Arguments (opt)
    let args = field.arguments; // e.g. id: "1000"

    let prefix = '';
    if (info_type instanceof GraphQLList) {
      info_type = info_type['ofType'];
      prefix = 'list ';
    }

    if (info_type instanceof GraphQLNonNull) {
      info_type = info_type['ofType'];
    }

    if (info_type instanceof GraphQLUnionType) {
      // Union
      let expr = walkUnion(originalName, field, info);

      return expr;

    // SelectionSet
    } else if (field.selectionSet) {
        let fields = walkSelectionSet(field.selectionSet, info);
        info.leave(field);
        let fieldNames = getSelectionSetFields(field.selectionSet, info);
        let shape = `(\\${fieldNames.map(f => f + '_').join(' ')} -> { ${fieldNames.map(f => f + ' = ' + f + '_').join(', ')} })`;
        let left = '(field "' + originalName + '" \n';
        let right = '(map ' + shape + ' ' + fields.expr + '))';
        let indent = '        ';
        if (prefix) {
          left =  '(map (Maybe.withDefault []) (maybe' + left;
          right = '(' + prefix + right + ')))';
        }
        if (isMaybe) {
          right = '(' + 'maybe ' + right + ')';
        }

        return { expr: left + indent + right };

    } else {

      let decoder = leafTypeToDecoder(info_type);

      let right = '(field "' + originalName + '" (' + prefix + decoder +'))';

      if (isMaybe || (!include && !(info_type instanceof GraphQLList))) {
        right = '(maybe ' + right + ')';
      }

      info.leave(field);
      return { expr: right };
    }
  }

  function walkUnion(originalName: string, field: Field, info: TypeInfo): ElmExpr {
    let decoder = '\n        (\\typename -> case typename of';
    let indent = '            ';

    let union_type = info.getType();
    let union_name = "";

    let prefix = "";
    let isMaybe = true;

    if (union_type instanceof GraphQLNonNull) {
      union_type = union_type['ofType'];
      isMaybe = false;
    }

    if (union_type instanceof GraphQLList) {
      union_type = union_type['ofType'];
      prefix = "list ";
    }

    if (union_type instanceof GraphQLNonNull) {
        union_type = union_type['ofType'];
    }

    if (union_type instanceof GraphQLUnionType) {
      union_name = union_type.name;
    }

    for (let sel of field.selectionSet.selections) {
      if (sel.kind == 'InlineFragment') {
        let inlineFragment = <InlineFragment> sel;
        decoder += `\n${indent}"${inlineFragment.typeCondition.name.value}" -> `;

        info.enter(inlineFragment);
        let fields = walkSelectionSet(inlineFragment.selectionSet, info);
        info.leave(inlineFragment);
        let fieldNames = getSelectionSetFields(inlineFragment.selectionSet, info);
        let ctor = elmSafeName((union_name+'_'+inlineFragment.typeCondition.name.value));
        let shape = `(\\${fieldNames.map(f => f + '_').join(' ')} -> ${ctor} { ${fieldNames.map(f => f + ' = ' + f + '_').join(', ')} })`;
        let right = '(map ' + shape + ' ' + fields.expr.split('\n').join(' ') + '\n)';
        decoder += right;

      } else if (sel.kind == 'Field') {
        let field = <Field>sel;
        if (field.name.value != '__typename') {
          throw new Error('Unexpected field: ' + field.name.value);
        }
      } else if (sel.kind == 'FragmentSpread') {
        // expand out all fragment spreads
          let spreadName = (<FragmentSpread>sel).name.value;
          let def = fragmentDefinitionMap[spreadName];
          let name = def.typeCondition.name.value;
          decoder += `\n${indent}"${name}" -> `;

          info.enter(def)
          let fields = walkSelectionSet(def.selectionSet, info);
          let fieldNames = getSelectionSetFields(def.selectionSet, info);
          info.leave(def)
          let ctor = elmSafeName((union_name+'_'+name));
          let shape = `(\\${fieldNames.map(f => f + '_').join(' ')} -> ${ctor} { ${fieldNames.map(f => f + ' = ' + f + '_').join(', ')} })`;
          let right = '(map ' + shape + ' ' + fields.expr.split('\n').join(' ') + '\n)';
          decoder += right;
      } else {
        throw new Error('Unexpected: ' + sel.kind);
      }
    }

    decoder += `\n${indent}_ -> fail "Unexpected union type")`;

    decoder = '((field "__typename" string) |> andThen ' + decoder + ')';

    if (prefix) {
        decoder = '(' + prefix + decoder + ')';
    }
    if (isMaybe) {
        decoder = '(' + 'maybe ' + decoder + ')';
    }

    return { expr: '(field "' + originalName + '" ' + decoder +')' };
  }

  function leafTypeToDecoder(type: GraphQLType): string {

    if (type instanceof GraphQLNonNull) {
      type = type['ofType'];
    }

    // leaf types only
    if (type instanceof GraphQLScalarType) {
      switch (type.name) {
        case 'Int': return 'int';
        case 'Float': return 'float';
        case 'Boolean': return 'bool';
        case 'ID':
        case 'DateTime': return 'string';
	case 'UnixTimestamp': return 'map ((*) 1000 >> Time.millisToPosix) int';
        case 'String': return 'string';
        default: return 'string';
      }
    } else if (type instanceof GraphQLEnumType) {
      return type.name.toLowerCase() + 'Decoder';
    } else {
      throw new Error('not a leaf type: ' + (<any>type).name);
    }
  }

  return walkDefinition(def, info);
}
