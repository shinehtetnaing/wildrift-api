import express from "express";
import prisma from "../../prisma/prismaClient.js";
import { hashPassword } from "../utils/passwordHelpers.js";

const router = express.Router();

router.get("/", async (req, res) => {
  const users = await prisma.user.findMany();
  res.status(200).json(users);
});

router.post("/", async (req, res) => {
  const { email, password } = req.body;

  const hashedPassword = await hashPassword(password);
  await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
    },
  });
  res.status(201).json({ message: "User created successfully" });
});

export default router;
