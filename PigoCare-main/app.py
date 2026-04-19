import os
import json
import cloudinary
import cloudinary.uploader
from flask import Flask, request, jsonify
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.utils import secure_filename
from sqlalchemy import text
from datetime import datetime, timezone, timedelta

app = Flask(__name__)
CORS(app, origins=["*"])  # Allow all origins for production


CLOUDINARY_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME") or os.environ.get("CLOUD_NAME")
CLOUDINARY_API_KEY    = os.environ.get("CLOUDINARY_API_KEY")    or os.environ.get("API_KEY")
CLOUDINARY_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET") or os.environ.get("API_SECRET")

cloudinary.config(
    cloud_name=CLOUDINARY_CLOUD_NAME,
    api_key=CLOUDINARY_API_KEY,
    api_secret=CLOUDINARY_API_SECRET
)

# Warn loudly if Cloudinary is not properly configured
if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
    print("⚠️  WARNING: Cloudinary env vars are missing! Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET on Render.")
else:
    print(f"✅ Cloudinary configured — cloud: {CLOUDINARY_CLOUD_NAME}, key: {CLOUDINARY_API_KEY[:6]}***")


# Configure PostgreSQL Database
db_url = os.environ.get("DATABASE_URL")

if db_url and db_url.startswith("postgres://"):
    db_url = db_url.replace("postgres://", "postgresql://", 1)

app.config["SQLALCHEMY_DATABASE_URI"] = db_url
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Initialize SQLAlchemy
db = SQLAlchemy(app)

# Database Model
class Pig(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    pig_name = db.Column(db.String(100), nullable=False)
    pig_id = db.Column(db.String(100), unique=True, nullable=False)
    dob = db.Column(db.String(50), nullable=False)
    farm_name = db.Column(db.String(150), nullable=False)
    farm_address = db.Column(db.String(250), nullable=False)
    vaccinated = db.Column(db.Boolean, default=False)
    vaccine_date = db.Column(db.String(50), nullable=True)
    breed = db.Column(db.String(100), nullable=False)
    image = db.Column(db.Text, nullable=False)  # JSON array of Cloudinary URLs
    registration_date = db.Column(db.String(50), default=lambda: datetime.now(timezone(timedelta(hours=5, minutes=30))).strftime("%d/%m/%Y %H:%M:%S"), nullable=True)

    def to_dict(self):
        # Parse images — supports legacy single URL and new JSON array
        try:
            images = json.loads(self.image)
            if not isinstance(images, list):
                images = [str(images)]
        except (json.JSONDecodeError, TypeError, ValueError):
            images = [self.image] if self.image else []
        return {
            'id': self.id,
            'pig_name': self.pig_name,
            'pig_id': self.pig_id,
            'dob': self.dob,
            'farm_name': self.farm_name,
            'farm_address': self.farm_address,
            'vaccinated': self.vaccinated,
            'vaccine_date': self.vaccine_date,
            'breed': self.breed,
            'image': images[0] if images else '',  # first image (backward compat)
            'images': images,                        # all images
            'registration_date': self.registration_date,
        }

# Create database tables automatically
with app.app_context():
    db.create_all()
    # Widen image column to TEXT in PostgreSQL (idempotent migration)
    try:
        with db.engine.connect() as conn:
            conn.execute(text("ALTER TABLE pig ALTER COLUMN image TYPE TEXT USING image::TEXT"))
            conn.commit()
        print("[Migration] image column widened to TEXT ✓")
    except Exception as e:
        print(f"[Migration] Note: {e} (column may already be TEXT — OK)")
        
    # Add registration_date column if it doesn't exist
    try:
        with db.engine.connect() as conn:
            conn.execute(text("ALTER TABLE pig ADD COLUMN registration_date VARCHAR(50)"))
            conn.commit()
        print("[Migration] registration_date column added ✓")
    except Exception as e:
        print(f"[Migration] Note: {e} (column may already exist — OK)")


@app.route("/")
def home():
    return "Server is LIVE 🚀"

def generate_pig_id():
    """Generate a unique serial pig ID in format PC-YY-NNNN (e.g. PC-26-0001)."""
    from datetime import datetime
    year = datetime.now().strftime('%y')   # '26' for 2026
    prefix = f'PC-{year}-'

    # Find the highest serial number already used this year
    existing = Pig.query.filter(Pig.pig_id.like(f'{prefix}%')).all()
    max_serial = 0
    for pig in existing:
        try:
            serial = int(pig.pig_id.replace(prefix, ''))
            if serial > max_serial:
                max_serial = serial
        except ValueError:
            pass

    return f'{prefix}{max_serial + 1:04d}'


# Endpoint to upload pig data
@app.route('/upload', methods=['POST'])
def upload_pig():
    try:
        # 0. Guard — Cloudinary must be configured
        if not all([CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET]):
            return jsonify({'error': 'Image upload service is not configured on the server. Please set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET in Render environment variables.'}), 503

        # 1. Check if images are part of the request (up to 5)
        image_files = request.files.getlist('image')
        valid_images = [f for f in image_files if f and f.filename]
        if not valid_images:
            return jsonify({'error': 'No image file provided in request'}), 400
        if len(valid_images) > 5:
            valid_images = valid_images[:5]  # hard cap at 5

        # 2. Retrieve form data
        pig_name = request.form.get('pig_name')
        dob = request.form.get('dob')
        farm_name = request.form.get('farm_name')
        farm_address = request.form.get('farm_address')
        vaccinated_str = request.form.get('vaccinated', 'false').lower()
        vaccinated = vaccinated_str in ['true', '1', 'yes']
        vaccine_date = request.form.get('vaccine_date')
        breed = request.form.get('breed')

        # 3. Validate required fields (pig_id is auto-generated)
        if not all([pig_name, dob, farm_name, farm_address, breed]):
            return jsonify({'error': 'Missing required fields'}), 400

        # 4. Auto-generate a unique serial pig ID
        pig_id = generate_pig_id()

        # 5. Upload all images to Cloudinary
        image_urls = []
        for img_file in valid_images:
            result = cloudinary.uploader.upload(img_file)
            image_urls.append(result['secure_url'])
        image_json = json.dumps(image_urls)

        # 6. Store metadata in database
        from datetime import datetime, timezone, timedelta
        ist = timezone(timedelta(hours=5, minutes=30))
        now_str = datetime.now(ist).strftime("%d/%m/%Y %H:%M:%S")
        new_pig = Pig(
            pig_name=pig_name,
            pig_id=pig_id,
            dob=dob,
            farm_name=farm_name,
            farm_address=farm_address,
            vaccinated=vaccinated,
            vaccine_date=vaccine_date,
            breed=breed,
            image=image_json,
            registration_date=now_str
        )
        db.session.add(new_pig)
        db.session.commit()

        return jsonify({
            'message': 'Pig uploaded successfully', 
            'pig': new_pig.to_dict()
        }), 201

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Endpoint to get all pigs
@app.route('/pigs', methods=['GET'])
def get_pigs():
    try:
        pigs = Pig.query.all()
        # Return full image URL in JSON for each pig
        pig_list = []
        for pig in pigs:
            pig_list.append(pig.to_dict())
            
        return jsonify(pig_list), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Endpoint to update a pig's details
@app.route('/update/<pig_id>', methods=['PUT', 'POST'])
def update_pig(pig_id):
    try:
        pig = Pig.query.filter_by(pig_id=pig_id).first()
        if not pig:
            return jsonify({'error': 'Pig not found'}), 404

        # Update text fields if they are provided in the request
        if 'pig_name' in request.form:
            pig.pig_name = request.form['pig_name']
        if 'dob' in request.form:
            pig.dob = request.form['dob']
        if 'farm_name' in request.form:
            pig.farm_name = request.form['farm_name']
        if 'farm_address' in request.form:
            pig.farm_address = request.form['farm_address']
        if 'vaccinated' in request.form:
            vaccinated_str = request.form['vaccinated'].lower()
            pig.vaccinated = vaccinated_str in ['true', '1', 'yes']
        if 'vaccine_date' in request.form:
            pig.vaccine_date = request.form['vaccine_date']
        if 'breed' in request.form:
            pig.breed = request.form['breed']

        # Update images using image_order slot system
        # Frontend sends image_order as JSON (URLs + __fN placeholders) and files as img_N
        image_order_str = request.form.get('image_order')
        if image_order_str is not None:
            try:
                image_order = json.loads(image_order_str)
            except Exception:
                image_order = []

            # Upload slot files (img_0, img_1, ...)
            uploaded_slots = {}
            for i in range(5):
                f = request.files.get(f'img_{i}')
                if f and f.filename:
                    result = cloudinary.uploader.upload(f)
                    uploaded_slots[f'__f{i}'] = result['secure_url']

            # Reconstruct final ordered URL array (cover = first)
            final_urls = []
            for item in image_order[:5]:
                if isinstance(item, str) and item.startswith('__f'):
                    url = uploaded_slots.get(item)
                    if url:
                        final_urls.append(url)
                elif isinstance(item, str) and item:
                    final_urls.append(item)   # existing Cloudinary URL

            if final_urls:
                pig.image = json.dumps(final_urls)

        db.session.commit()
        return jsonify({'message': 'Pig updated successfully', 'pig': pig.to_dict()}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500

# Endpoint to search pigs
@app.route('/search', methods=['GET'])
def search_pigs():
    try:
        query = request.args.get('query', '')
        if not query:
            return jsonify([]), 200

        search_term = f"%{query}%"
        
        # Search across multiple fields (case-insensitive)
        results = Pig.query.filter(
            db.or_(
                Pig.pig_name.ilike(search_term),
                Pig.pig_id.ilike(search_term),
                Pig.farm_name.ilike(search_term),
                Pig.farm_address.ilike(search_term),
                Pig.breed.ilike(search_term)
            )
        ).all()

        pig_list = []
        for pig in results:
            pig_list.append(pig.to_dict())

        return jsonify(pig_list), 200
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# Endpoint to delete a pig
@app.route('/delete/<pig_id>', methods=['DELETE'])
def delete_pig(pig_id):
    try:
        pig = Pig.query.filter_by(pig_id=pig_id).first()
        if not pig:
            return jsonify({'error': 'Pig not found'}), 404

        db.session.delete(pig)
        db.session.commit()

        return jsonify({'message': f'{pig.pig_name} deleted successfully'}), 200

    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Run the server on 0.0.0.0 so it's accessible from other devices on the network
    app.run(host='0.0.0.0', port=5001, debug=True)
