require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const customerRoutes = require("./routes/customers");
const cylinderRoutes = require("./routes/cylinders");
const orderRoutes = require("./routes/orders");
const notificationRoutes = require("./routes/notifications");
const settingsRoutes = require("./routes/settings");
const typeRoutes = require("./routes/types");
const taskRoutes = require("./routes/tasks");
const { seedDemoIfNeeded } = require("./utils/seed");

const app = express();
const PORT = process.env.PORT || 4000;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(uploadsDir));
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/cylinders", cylinderRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/types", typeRoutes);
app.use("/api/tasks", taskRoutes);

app.get("/api/health", (req, res) => res.json({ ok: true }));

// Fallback to landing page for unknown non-API routes
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server." });
});

seedDemoIfNeeded();

app.listen(PORT, () => {
  console.log(`\nAditi Enterprises system running at http://localhost:${PORT}\n`);
  if (!process.env.JWT_SECRET) {
    console.log("WARNING: Using a default dev JWT secret. Copy .env.example to .env and set your own before real use.\n");
  }
});
