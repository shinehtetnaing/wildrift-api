import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import crypto from "crypto";
import express from "express";
import multer from "multer";
import prisma from "../../prisma/prismaClient.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() }); // Use memory storage for temporary file storage

const s3 = new S3Client({
  region: process.env.AWS_BUCKET_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

router.get("/", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;

    const offset = (page - 1) * limit;

    const champions = await prisma.champion.findMany({
      skip: offset,
      take: limit,
    });

    const totalChampions = await prisma.champion.count();

    const totalPages = Math.ceil(totalChampions / limit);

    res.json({
      page,
      limit,
      totalPages,
      totalChampions,
      champions,
    });
  } catch (error) {
    console.error("Error fetching champions:", error);
    res.status(500).json({ error: "Failed to fetch champions" });
  }
});

router.get("/:name", async (req, res) => {
  const { name } = req.params;
  const capitalizedName =
    name.charAt(1).toUpperCase() + name.slice(2).toLowerCase();

  const champion = await prisma.champion.findUnique({
    where: {
      name: capitalizedName,
    },
  });

  if (!champion) {
    return res.status(404).json({ error: "Champion not found" });
  }

  res.json(champion);
});

router.post("/", upload.single("image"), async (req, res) => {
  const { name, role } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: "Image is required" });
  }

  const acceptedMimeTypes = [
    "image/png",
    "image/jpg",
    "image/jpeg",
    "image/webp",
  ];

  if (!acceptedMimeTypes.includes(req.file.mimetype)) {
    return res.status(403).json({ error: "Invalid file type" });
  }

  const maxFileSize = 1024 * 1024 * 5; // 5MB

  if (req.file.size > maxFileSize) {
    return res.status(403).json({ error: "File is too large" });
  }

  // Generate a unique filename
  const uniqueFilename = crypto.randomBytes(16).toString("hex");
  const fileExtension = req.file.mimetype.split("/")[1];
  const key = `${
    req.file.originalname.split(".")[0]
  }-${uniqueFilename}.${fileExtension}`;

  const command = new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME,
    Key: key,
    Body: req.file.buffer,
    ContentType: req.file.mimetype,
    ContentLength: req.file.size,
  });

  try {
    await s3.send(command);

    // Generate the file URL
    const imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_BUCKET_REGION}.amazonaws.com/${key}`;

    // Split the role string into an array
    const roleArray = role.split(",").map((r) => r.trim());

    // Validate roles against the allowed enum values
    const validRoles = ["SOLO", "JUNGLE", "MID", "ADC", "SUPPORT"];
    if (!roleArray.every((r) => validRoles.includes(r))) {
      return res.status(400).json({ error: "Invalid role(s) provided" });
    }

    const result = await prisma.champion.create({
      data: {
        name,
        role: roleArray,
        imagePath: imageUrl,
      },
    });
    res.status(201).json({ message: "Champion created successfully", result });
  } catch (error) {
    console.error("Error uploading file or saving to database:", error);
    res.status(500).json({ error: "Failed to upload file or save data" });
  }
});

router.put("/:name", upload.single("image"), async (req, res) => {
  const { name } = req.params;
  const { name: newName, role } = req.body;
  const capitalizedName =
    name.charAt(1).toUpperCase() + name.slice(2).toLowerCase();

  try {
    const champion = await prisma.champion.findUnique({
      where: {
        name: capitalizedName,
      },
    });

    if (!champion) {
      return res.status(404).json({ error: "Champion not found" });
    }

    let imageUrl = champion.imagePath; // Keep existing image path if no new image

    // Handle image update if a new file is provided
    if (req.file) {
      const acceptedMimeTypes = [
        "image/png",
        "image/jpg",
        "image/jpeg",
        "image/webp",
      ];
      if (!acceptedMimeTypes.includes(req.file.mimetype)) {
        return res.status(403).json({ error: "Invalid file type" });
      }

      const maxFileSize = 1024 * 1024 * 5; // 5MB
      if (req.file.size > maxFileSize) {
        return res.status(403).json({ error: "File is too large" });
      }

      // Delete the existing image from S3
      const existingKey = champion.imagePath.split("amazonaws.com/")[1];
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: existingKey,
      });
      await s3.send(deleteCommand);

      // Upload the new image to S3
      const uniqueFilename = crypto.randomBytes(16).toString("hex");
      const fileExtension = req.file.mimetype.split("/")[1];
      const newKey = `${
        req.file.originalname.split(".")[0]
      }-${uniqueFilename}.${fileExtension}`;

      const uploadCommand = new PutObjectCommand({
        Bucket: process.env.AWS_BUCKET_NAME,
        Key: newKey,
        Body: req.file.buffer,
        ContentType: req.file.mimetype,
        ContentLength: req.file.size,
      });

      await s3.send(uploadCommand);

      // Generate new file URL
      imageUrl = `https://${process.env.AWS_BUCKET_NAME}.s3.${process.env.AWS_BUCKET_REGION}.amazonaws.com/${newKey}`;
    }

    // Validate roles if provided
    let roleArray = champion.role; // Keep existing roles if not provided
    if (role) {
      roleArray = role.split(",").map((r) => r.trim());
      const validRoles = ["SOLO", "JUNGLE", "MID", "ADC", "SUPPORT"];
      if (!roleArray.every((r) => validRoles.includes(r))) {
        return res.status(400).json({ error: "Invalid role(s) provided" });
      }
    }

    // Update champion in the database
    const updatedChampion = await prisma.champion.update({
      where: {
        name: capitalizedName,
      },
      data: {
        name: newName || champion.name,
        role: roleArray,
        imagePath: imageUrl,
      },
    });

    res
      .status(200)
      .json({ message: "Champion updated successfully", updatedChampion });
  } catch (error) {
    console.error("Error updating champion:", error);
    res.status(500).json({ error: "Failed to update champion" });
  }
});

router.delete("/:name", async (req, res) => {
  const { name } = req.params;
  const capitalizedName =
    name.charAt(1).toUpperCase() + name.slice(2).toLowerCase();

  try {
    const champion = await prisma.champion.findUnique({
      where: {
        name: capitalizedName,
      },
    });

    if (!champion) {
      return res.status(404).json({ error: "Champion not found" });
    }

    const key = champion.imagePath.split("amazonaws.com/")[1];

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_BUCKET_NAME,
      Key: key,
    });

    await s3.send(command);

    await prisma.champion.delete({
      where: {
        id: champion.id,
      },
    });

    res.status(200).json({ message: "Champion deleted successfully" });
  } catch (error) {
    console.error("Error deleting champion:", error);
    res.status(500).json({ error: "Failed to delete champion" });
  }
});

export default router;
