const { v4: uuidv4 } = require("uuid");

const uid = () => uuidv4();
const pad = (n, len) => String(n).padStart(len, "0");

module.exports = {
  uid,
  customerId: (seq) => `CUST-${pad(seq, 4)}`,
  orderId: (seq) => `ORD-${pad(seq, 5)}`,
  cylinderId: (seq) => `CYL-${pad(seq, 5)}`,
  taskId: (seq) => `TSK-${pad(seq, 5)}`,
  typeId: (seq) => `TYP-${pad(seq, 4)}`,
};
