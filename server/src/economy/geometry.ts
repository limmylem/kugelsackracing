// (a stored route's path, decoded: route/geometry.js — its first point centres the projection the server
// drives its course on)
import { decodeLine } from '../../../route/geometry.js';
export const decodePath = (course: any): { lat: number; lon: number }[] | null => { try { return course?.path ? decodeLine(course.path) : null; } catch { return null; } };
