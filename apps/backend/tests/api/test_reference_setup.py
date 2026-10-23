"""Synthetic integration only; does not establish real-product accuracy."""
import io
import sys
from pathlib import Path
from uuid import uuid4
import cv2
import pytest
from PIL import Image
from fastapi.testclient import TestClient
from app.main import app
from app.core.config import settings
from app.services.inspection_adapter import InspectionAdapter
from app.services.reference_profile import load_profile
sys.path.insert(0,str(Path(__file__).parents[1]/'inspection'))
from test_detector import bottle_image


def encoded(kind='a', blur=False):
    image=bottle_image(kind)
    if blur:
        image=cv2.GaussianBlur(image,(51,51),12)
    output=io.BytesIO();Image.fromarray(image).save(output,format='PNG')
    return output.getvalue()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings,'DEFAULT_TO_DEMO',False)
    monkeypatch.setattr(InspectionAdapter,'_detector_config',None)
    monkeypatch.setattr(settings,'SUPPORTED_PRODUCTS',list(settings.SUPPORTED_PRODUCTS))
    monkeypatch.setattr(settings,'CONFIG_VERSION',settings.CONFIG_VERSION)
    with TestClient(app) as client:
        yield client


def enroll(client,kind):
    return client.post('/api/reference-profile',data={
        'product_id':'bottle_'+kind,'name':'Synthetic '+kind,
        'crop':'[0.325,0.402777778,0.35,0.208333333]',
        'acknowledge_experimental':'true'},
        files={'image':('reference.png',encoded(kind),'image/png')})


def test_reference_enrollment_live_decisions_and_restart(client):
    assert not client.get('/api/reference-profile').json()['ready']
    first=enroll(client,'a');assert first.status_code==200,first.text
    assert not first.json()['ready']
    second=enroll(client,'b');assert second.status_code==200,second.text
    assert second.json()['ready'] and not second.json()['validated']
    assert not InspectionAdapter.get_detector_config().validated
    InspectionAdapter.set_detector_config(None)
    load_profile()
    assert InspectionAdapter.is_detector_ready()
    for kind,blur,expected in [('a',False,'PASS'),('b',False,'FAIL'),('a',True,'REVIEW')]:
        result=client.post('/api/inspections',data={'expected_product':'bottle_a',
            'source_mode':'webcam','client_request_id':str(uuid4()),'demo':'false'},
            files={'image':('test.png',encoded(kind,blur),'image/png')})
        assert result.status_code==200,result.text
        record=result.json()
        assert record['result']==expected,record
        assert record['demo'] is False
        files=client.get('/api/inspections/'+record['inspection_id']+'/files').json()
        assert files['all_available']


def test_setup_rejects_missing_acknowledgement_and_bad_crop(client):
    response=client.post('/api/reference-profile',data={'product_id':'bottle_a','name':'test','crop':'[0,0,1,1]'},
        files={'image':('test.png',encoded(),'image/png')})
    assert response.status_code==400
    response=client.post('/api/reference-profile',data={'product_id':'bottle_a','name':'test',
        'crop':'[0,0,2,1]','acknowledge_experimental':'true'},files={'image':('test.png',encoded(),'image/png')})
    assert response.status_code==400
    assert not client.get('/api/reference-profile').json()['products']
