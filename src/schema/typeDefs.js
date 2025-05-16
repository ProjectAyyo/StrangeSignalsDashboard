const { gql } = require('graphql-tag');

const typeDefs = gql`
  type Alert {
    id: ID!
    symbol: String!
    signal: String!
    price: Float!
    timestamp: String!
    status: String!
    notes: String
    price_4m: Float
    price_20m: Float
    price_1h: Float
    price_next: Float
    accuracy_4m: Int
    accuracy_20m: Int
    accuracy_1h: Int
    accuracy_next: Int
  }

  input AlertInput {
    symbol: String!
    signal: String!
    price: Float!
    notes: String
  }

  type Query {
    alerts: [Alert!]!
    alert(id: ID!): Alert
    alertsBySymbol(symbol: String!): [Alert!]!
  }

  type Mutation {
    createAlert(input: AlertInput!): Alert!
    updateAlertStatus(id: ID!, status: String!): Alert!
    deleteAlert(id: ID!): Boolean!
  }

  type Subscription {
    alertCreated: Alert!
    alertUpdated: Alert!
  }
`;

module.exports = typeDefs; 