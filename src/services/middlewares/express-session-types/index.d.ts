// come back to understand this later; declarative merging ?

import "express-session"

declare module "express-session" {
	interface SessionData {
		userId: string;
		csrfSecret: string
	}
}