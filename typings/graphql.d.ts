/// <reference path="./graphql-types.d.ts" />

/**                                                                             
    * GraphQL Main.                                                           
*/                                                                            

declare module "graphql" {                                            
    import { GraphQLOutputType, GraphQLSchema, GraphQLType, GraphQLInputType } from 'graphql/type';
    
    export function graphqlSync(
    	schema: GraphQLSchema,
    	source: string
    ): string;

    export function buildASTSchema(source: any): GraphQLSchema;

    export function parse(str: string): string;
}
