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
    price_4h: Float
    price_12h: Float
    price_1d: Float
    price_next: Float
    accuracy_4h: Int
    accuracy_12h: Int
    accuracy_1d: Int
    accuracy_next: Int
    mfe: Float
    mae: Float
    grade: String
    price_1h: Float
    accuracy_1h: Int
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