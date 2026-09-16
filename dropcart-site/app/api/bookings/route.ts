import { getRawDb } from "@/db";
import { handleBooking } from "@/lib/booking-handler";
export const POST=(request:Request)=>handleBooking(request,getRawDb);
