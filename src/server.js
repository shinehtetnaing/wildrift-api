import express from "express";
import championRoutes from "./routes/championRoutes.js";
import userRoutes from "./routes/userRoutes.js";

const app = express();
const PORT = process.env.PORT || 8000;

app.use(express.json());

// Routes
app.use("/api/users", userRoutes);
app.use("/api/champions", championRoutes);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
