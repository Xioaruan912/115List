package common

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/go-cache"
	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v4"
	"github.com/pkg/errors"
)

var SecretKey []byte

type UserClaims struct {
	Username string `json:"username"`
	PwdTS    int64  `json:"pwd_ts"`
	jwt.RegisteredClaims
}

var validTokenCache = cache.NewMemCache[bool]()

// GenerateToken signs a user in. With the request at hand (every sign-in path
// passes it) the token belongs to a device session that survives restarts and
// lasts while the device is used (tgvio_sessions.go); the JWT's own expiry is
// then only a far backstop.
func GenerateToken(user *model.User, c ...*gin.Context) (tokenString string, err error) {
	expires := time.Now().Add(time.Duration(conf.Conf.TokenExpiresIn) * time.Hour)
	sessionID := ""
	if len(c) > 0 && c[0] != nil {
		sessionID = NewDeviceSession(user.ID, user.Username, c[0].ClientIP(), c[0].GetHeader("User-Agent"))
		expires = time.Now().AddDate(10, 0, 0)
	}
	claim := UserClaims{
		Username: user.Username,
		PwdTS:    user.PwdTS,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        sessionID,
			ExpiresAt: jwt.NewNumericDate(expires),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			NotBefore: jwt.NewNumericDate(time.Now()),
		}}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claim)
	tokenString, err = token.SignedString(SecretKey)
	if err != nil {
		return "", err
	}
	validTokenCache.Set(tokenString, true)
	return tokenString, err
}

func ParseToken(tokenString string) (*UserClaims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &UserClaims{}, func(token *jwt.Token) (interface{}, error) {
		return SecretKey, nil
	})
	if token == nil {
		return nil, errors.New("that's not even a token")
	}
	if claims, ok := token.Claims.(*UserClaims); ok && claims.ID != "" {
		// A device session token: valid while its session is (checked on disk, not in memory).
		if s, found := DeviceSessionOf(claims.ID); !found || s.Username != claims.Username {
			return nil, errors.New("this device has been signed out")
		}
	} else if IsTokenInvalidated(tokenString) {
		return nil, errors.New("token is invalidated")
	}
	if err != nil {
		if ve, ok := err.(*jwt.ValidationError); ok {
			if ve.Errors&jwt.ValidationErrorMalformed != 0 {
				return nil, errors.New("that's not even a token")
			} else if ve.Errors&jwt.ValidationErrorExpired != 0 {
				return nil, errors.New("token is expired")
			} else if ve.Errors&jwt.ValidationErrorNotValidYet != 0 {
				return nil, errors.New("token not active yet")
			} else {
				return nil, errors.New("couldn't handle this token")
			}
		}
	}
	if claims, ok := token.Claims.(*UserClaims); ok && token.Valid {
		return claims, nil
	}
	return nil, errors.New("couldn't handle this token")
}

func InvalidateToken(tokenString string) error {
	if tokenString == "" {
		return nil // don't invalidate empty guest token
	}
	validTokenCache.Del(tokenString)
	if id := SessionIDOf(tokenString); id != "" {
		RevokeDeviceSession(id)
	}
	return nil
}

// SessionIDOf reads the device session id of a token without validating it.
func SessionIDOf(tokenString string) string {
	claims := &UserClaims{}
	if _, _, err := jwt.NewParser().ParseUnverified(tokenString, claims); err != nil {
		return ""
	}
	return claims.ID
}

func IsTokenInvalidated(tokenString string) bool {
	_, ok := validTokenCache.Get(tokenString)
	return !ok
}
