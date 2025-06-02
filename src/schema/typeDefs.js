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
    price_5m: Float
    price_1h: Float
    price_4h: Float
    price_next: Float
    price_next_4h: Float
    price_2d: Float
    price_1w: Float
    accuracy_5m: Int
    accuracy_1h: Int
    accuracy_4h: Int
    accuracy_next: Int
    accuracy_next_4h: Int
    accuracy_2d: Int
    accuracy_1w: Int
    mfe: Float
    mae: Float
    grade: String
  }

  input AlertInput {
    symbol: String!
    signal: String!
    price: Float
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