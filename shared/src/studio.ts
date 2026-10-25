import { z } from "zod";

export const Primitive = z.enum(["cube", "sphere", "cylinder", "cone", "torus", "capsule", "model"]);
export const EnvironmentPreset = z.enum(["studio", "forest", "desert", "ocean", "moon", "city"]);
export type EnvironmentPreset = z.infer<typeof EnvironmentPreset>;
export const SceneEnvironment = z.object({ preset: EnvironmentPreset, sky: z.string(), ground: z.string(), grid: z.boolean() });
export type SceneEnvironment = z.infer<typeof SceneEnvironment>;
const Transform = { rx: z.number().default(0), ry: z.number().default(0), rz: z.number().default(0), sx: z.number().min(0.05).max(100).default(1), sy: z.number().min(0.05).max(100).default(1), sz: z.number().min(0.05).max(100).default(1) };
const TransformPatch = z.object(Transform).partial().shape;
const Sculpt = { bulge: z.number().min(-0.8).max(1.5).default(0), taper: z.number().min(-0.9).max(0.9).default(0), twist: z.number().min(-360).max(360).default(0) };
const SculptPatch = z.object(Sculpt).partial().shape;
export const SceneObject = z.object({ ...Transform, ...Sculpt, id: z.string(), name: z.string(), primitive: Primitive, x: z.number(), y: z.number(), z: z.number(), size: z.number().min(0.2).max(5), color: z.string(), assetUrl: z.string().max(12_000_000).optional() });
export type SceneObject = z.infer<typeof SceneObject>;
export const Studio = z.object({ kind: z.literal("studio"), id: z.string(), title: z.string(), objects: z.array(SceneObject), environment: SceneEnvironment.optional() });
export type Studio = z.infer<typeof Studio>;
export const DEFAULT_ENVIRONMENT: SceneEnvironment = { preset: "studio", sky: "#f6f5ef", ground: "#e9e7de", grid: true };
export const emptyStudio = (id: string): Studio => ({ kind: "studio", id, title: "Untitled 3D scene", objects: [], environment: DEFAULT_ENVIRONMENT });

export const AddPrimitive = z.object({ type: z.literal("add_primitive"), ...TransformPatch, ...SculptPatch, id: z.string(), name: z.string(), primitive: Primitive, x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), size: z.number().min(0.2).max(5).optional(), color: z.string().optional(), assetUrl: z.string().max(12_000_000).optional() });
export const SetPrimitive = z.object({ type: z.literal("set_primitive"), ...TransformPatch, ...SculptPatch, id: z.string(), name: z.string().optional(), x: z.number().optional(), y: z.number().optional(), z: z.number().optional(), size: z.number().min(0.2).max(5).optional(), color: z.string().nullable().optional(), assetUrl: z.string().max(12_000_000).nullable().optional() });
export const DeletePrimitive = z.object({ type: z.literal("delete_primitive"), id: z.string() });
export const SetEnvironment = z.object({ type: z.literal("set_environment"), preset: EnvironmentPreset.optional(), sky: z.string().optional(), ground: z.string().optional(), grid: z.boolean().optional() });
export const RestorePrimitive = z.object({ type: z.literal("restore_primitive"), object: SceneObject, index: z.number().int().min(0) });
export const STUDIO_MODEL_OPS = ["add_primitive", "set_primitive", "delete_primitive"] as const;
