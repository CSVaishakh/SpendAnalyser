from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import analytics, rules, statements
from .config import CORS_ORIGINS
from .db import Base, engine
from .migrate import migrate


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(engine)
    backfill = migrate(engine)
    from .db import SessionLocal
    from .services.reprocess import mark_current, needs_reprocess, reprocess_all

    with SessionLocal() as session:
        if needs_reprocess(session) or backfill:
            reprocess_all(session)  # parser improved since these rows were imported
        else:
            mark_current(session)
        session.commit()
    yield


app = FastAPI(title="Spend Analyser API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.include_router(statements.router)
app.include_router(analytics.router)
app.include_router(rules.router)
